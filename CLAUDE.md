# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

GoWith 是"B站探店博主店铺地图集"——以 B站探店 UP 主为索引，将视频内容转化为全国可检索店铺情报的决策平台。产品形态为 Web 端 (Next.js)，核心闭环为：种子博主 → B站数据采集 → AI 视频理解 → 高德 POI 匹配 → 后台审核 → 前台店铺卡片 / 地图 / 博主页展示 → 用户行为沉淀 → 推荐迭代。

文档目录：`docs/` 下四份文档相互引用，必须同时阅读：

- `docs/PRD-bilibili-shop-map.md` —— 长期产品定位、用户场景、信息架构、推荐策略、技术栈、数据模型初稿、合规风险。
- `docs/MVP-bilibili-shop-map.md` —— MVP 范围、种子博主、数据采集、AI 工作流总览、推荐 MVP、技术方案、里程碑。
- `docs/MVP-ai-workflow-and-admin-spec.md` —— AI 各阶段 JSON Schema（视频分类、评论线索、视频结构化分析、POI 匹配、发布快照）、校验规则、后台页面字段、审核动作状态机。
- `docs/MVP-database-schema.md` —— PostgreSQL/PostGIS 完整表结构、索引、ER 图、读路径、迁移建议。

## MVP 范围与不做事项

MVP 仅围绕首批 5 个种子博主（UID: `3546888255048212`、`99157282`、`1781681364`、`544336675`、`8263502`）的全部视频做数据闭环验证，不做全站博主发现。

MVP 必做：博主种子库、B站登录态服务端维护、视频元信息同步、字幕 / Groq Whisper ASR、评论样本、AI 五阶段工作流、高德 POI 匹配、后台审核、Web 端首页 / 地图 / 博主 / 店铺详情 / 后台、用户行为埋点。

MVP 不做：全站探店博主发现、商家入驻、团购 / 交易、完整社交、App 原生端、复杂深度学习模型线上服务。

## 核心技术选型

| 层 | 选型 |
| --- | --- |
| 前端 | Next.js + React + TypeScript；Tailwind CSS + shadcn/Radix；高德地图 JS API；TanStack Query + Zustand；ECharts/Recharts |
| API 服务 | NestJS 或 Fastify（Node.js） |
| AI / 数据 Worker | Python FastAPI；任务队列 Redis Streams / BullMQ，演进到 Celery/Temporal |
| 数据库 | PostgreSQL 16+ + PostGIS（必装扩展）、pgcrypto、pg_trgm，可选 pgvector |
| 搜索 | MVP 用 PostgreSQL full-text + pg_trgm，后续切 OpenSearch |
| 缓存 | Redis |
| 对象存储 | S3 兼容存储（ASR 音频片段、字幕、原始响应缓存） |
| LLM | OpenAI SDK 接用户 token plan |
| ASR | Groq Whisper（默认 `whisper-large-v3-turbo`，重识别时切 `whisper-large-v3`） |
| 地图 | 高德优先（`amap`），保留 provider 抽象供后续接入腾讯 / 百度 |

## AI 工作流（五阶段管线）

所有 AI 输出必须结构化 JSON、可追溯到证据、缺失即输出 `unknown`。管线为：

```
Video Metadata + Subtitle/ASR + Comment Sample
  → 探店视频分类（classify_video）
  → 视频级店铺候选抽取（extract_shop_candidates）
  → 评论区店铺线索增强（comment_signal）
  → 视频级结构化总结（structure_video，schema_version: video_structured_analysis.v1）
  → 高德 POI 匹配（query_strategy: city_name_keyword，本地重排打分）
  → 后台审核 / 自动发布
```

关键约束（详见 `docs/MVP-ai-workflow-and-admin-spec.md` §1.1）：

- AI 不输出 Markdown / 自由文本，只输出 JSON。
- 信息不足时输出 `unknown` / `null` / `[]`，并在 `missing_fields` 或 `risk_flags` 中标记。
- 每个重要结论必须绑定 `evidence_ids`；字幕/ASR 为主证据，评论为辅，评论不能单独覆盖视频结论。
- 视频级结果先产出，再聚合到 `Shop`。
- 低置信度结果进后台，不进前台推荐。
- `prompt_version`、`model_version`、`input_hash` 必须留痕以便回放和模型评估。

POI 匹配阈值：

| match_score | 状态 |
| --- | --- |
| `>= 0.9` 且无风险 | `auto_matched` |
| `0.65 <= score < 0.9` | `need_review` |
| `< 0.65` | `low_confidence` |
| 无候选 | `no_candidate` |
| 店名缺失 / 同名分店多 / 搬迁风险 | 强制 `need_review` |

前台发布门槛：`is_shop_visit = true`、至少一个候选通过审核、有有效 POI、有推荐文案、`shop_confidence >= 0.7`、无未处理高风险标记。

## 数据架构核心约束

读 `docs/MVP-database-schema.md` §3 ER 图与 §14 生命周期。重要分层原则：

- **原始数据 / 中间结果 / 人工审核 / 前台发布四层分表保存**。`shop_candidates` ≠ `shops`；候选经 POI 匹配 + 审核才成为正式店铺。
- **AI 输出保留原始 JSON** 在 `ai_runs.output_payload` 和 `ai_video_analyses.analysis_json`，便于调试、回放、模型评估。
- **前台只读 `shops` 和 `published_shop_snapshots`**，不直接读未审核 AI 中间表。
- **POI 强匹配键 = `provider + provider_poi_id`**，坐标体系（GCJ-02 / BD-09 / WGS-84）必须在 `pois.coord_type` 显式标记，禁止混用。
- **推荐训练数据从第一天记录**：所有曝光 / 点击必须带 `recommendation_request_id` 和 `recommendation_item_id`，`recommendation_items.feature_snapshot` 必须保存当时排序特征。

视频到店铺的完整链路：`creators → videos → video_text_assets / video_comments → ai_runs → ai_video_analyses → shop_candidates → poi_match_attempts / poi_match_candidates → shops → shop_video_mentions → published_shop_snapshots`。

地图视窗查询统一走 `shops.geom && ST_MakeEnvelope(...)`，`geom` 存 GCJ-02 时前端必须传同坐标系视窗。

迁移建议按四个 migration 推进：①扩展 + 基础表 → ②AI 与候选店铺表 → ③POI/shops/review 表 → ④推荐日志表。

## B站数据采集要点

- 服务端统一维护登录态，Cookie 加密存 `bilibili_auth_accounts.encrypted_cookie`，绝不打日志、前端绝不暴露凭据。
- 民间 API 文档仅作内部验证参考；上线产品需重新评估 B站平台协议、授权、展示边界。
- 视频同步分四类独立任务：元信息、字幕、ASR、评论；每任务有状态、重试次数、错误原因（登录失效 / 接口变更 / 权限不足 / 限流 / 网络错误）。
- ASR：长视频需切片、重叠转写、结果合并；建议先转 16KHz mono + FLAC；Groq free tier 文件上限 25MB，dev tier 100MB，超出需本地切片。
- 评论样本采用热评 + 最新评论 + 关键词评论混合抽样；评论用户信息只保存 hash，不默认前台展示原文。

## 高德地图成本与配额

基础搜索服务：个人认证 5,000 次/月，企业认证 50,000 次/月，技术服务许可 500,000 次/月。流量包 30 元/万次。建议 POI 搜索结果缓存、原始响应入库（`raw_ingest_payloads`），便于排查和降本。

## 后台审核设计

一人使用后台，优先做任务队列，菜单按 `docs/MVP-ai-workflow-and-admin-spec.md` §11.1 列出（MVP 先实现：工作台、博主管理、视频任务、店铺候选、POI 审核、已发布店铺）。

视频详情审核页三栏布局：左字幕/ASR 时间轴，中 AI JSON 可读视图，右候选店铺/评论线索/风险标记/审核操作。

每次人工操作必须写 `review_events` 审计日志（含 `before_json` / `after_json` / `reviewer_id` / `reason`），人工编辑优先级高于 AI 和自动 POI 匹配，可回滚。

自动生成 `review_tasks` 的触发条件见 `docs/MVP-database-schema.md` §14.2：分类置信度低、店名缺失、generic_name 风险、多店铺、POI 无候选 / 低置信 / 同名候选多、评论提搬迁闭店、AI 校验失败。

## 推荐系统 MVP

前台先用规则排序，公式见 `docs/MVP-bilibili-shop-map.md` §9.1。从第一天记录埋点事件：`shop_card_impression` / `shop_card_click` / `shop_detail_view` / `map_pin_click` / `creator_filter_apply` / `favorite_shop` / `want_to_go` / `navigation_click` / `video_source_click` / `negative_feedback`。每次曝光带 `request_id`，行为可回溯推荐上下文。

演进路线：V0 规则 → V1 LightGBM/XGBoost Ranker → V2 双塔召回 → V3 DeepFM/DCN/DIN 多目标排序。MVP 阶段重点是保证数据结构和日志可训练。

## 合规风险与红线

- 优先展示跳转 B站原视频，不搬运视频内容；AI 总结以摘要和观点聚合为主，避免复制大段原文。
- 评论区只做聚合洞察，不默认公开评论用户信息；高风险负面结论必须进入审核。
- 不绕过反爬、模拟登录批量拉取；上线前必须法务评估 B站数据采集、评论处理、视频摘要的协议与版权边界。
- 国内地图使用 GCJ-02 坐标系；混用 WGS-84/BD-09 必须显式坐标转换和来源标记。
- 所有 AI 结论展示"AI 总结，仅供参考"，必须能查看来源。

## 常用命令

> 项目当前处于 MVP 早期规划阶段（v0.1，2026-06-16），`docs/` 下只有产品规格，未生成应用代码。下方命令为待落地实施时的预期命令；按 PRD §9 推荐技术栈整理。

环境前提：Node.js 20+、Python 3.11+、PostgreSQL 16+（含 PostGIS）、Redis 7+、Groq API Key、OpenAI API Key、高德 Web/JS API Key。

初始化与运行：

```bash
# 安装依赖（前端 + 后端 monorepo 结构待定，常见方式）
pnpm install
# 或
npm install

# 启动 PostgreSQL + Redis（建议 docker-compose）
docker compose up -d postgres redis

# 启用扩展
psql -d gowith -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 数据库迁移（按 docs/MVP-database-schema.md §19 四个 migration 顺序）
pnpm db:migrate
# 或
alembic upgrade head   # Python 侧
psql -d gowith -f migrations/001_extensions_and_base.sql
psql -d gowith -f migrations/002_ai_and_candidates.sql
psql -d gowith -f migrations/003_poi_shops_review.sql
psql -d gowith -f migrations/004_recommendation_logs.sql

# 启动开发服务
pnpm dev                # 前端 Next.js
pnpm dev:api            # NestJS/Fastify API
pnpm dev:worker         # Python AI Worker
pnpm dev:admin          # 后台管理

# 运行测试
pnpm test               # 前端单元 + 集成
pnpm test:e2e           # Playwright E2E
pytest                  # Python AI Worker 测试
pytest tests/poi_matcher_test.py  # 单测示例
```

代码质量：

```bash
pnpm lint               # ESLint + Prettier
pnpm typecheck          # tsc --noEmit
ruff check . && mypy .  # Python 侧
```

构建：

```bash
pnpm build              # Next.js 生产构建
```

## 开发里程碑

按 `docs/MVP-bilibili-shop-map.md` §14：

- **M1 数据采集跑通**：种子 UID 入库、视频元信息、字幕、Groq Whisper ASR、评论样本。
- **M2 AI 视频理解跑通**：分类、候选抽取、评论线索、结构化总结、JSON Schema 校验。
- **M3 POI 与后台跑通**：高德搜索、候选重排、后台审核、店铺合并、发布状态流转。
- **M4 前台 MVP**：首页卡片流、地图页、博主页、店铺详情页、登录与收藏。
- **M5 推荐数据闭环**：规则推荐、埋点、用户行为表、训练样本导出、第一版离线排序实验。

## MVP 验收指标

数据链路：5 个博主全量视频同步成功率 ≥ 90%；有字幕或 ASR 文本的视频占比 ≥ 80%；探店分类抽检准确率 ≥ 85%；候选抽取抽检准确率 ≥ 75%；高德 POI 人工确认准确率 ≥ 80%；AI 结构化 JSON 校验通过率 ≥ 95%。
产品链路：首页 / 地图 / 博主 / 店铺详情 / 后台五大功能可用。
推荐链路：行为日志完整、每次曝光有 `request_id`、点击 / 收藏 / 导航可回溯推荐上下文。

## 开放问题（需先确认再动工）

PRD §15 与 MVP §15 列出 15+ 待确认问题，关键几条：产品名是否确定为 GoWith、Web 登录方式、首页默认推荐按博主优先还是城市优先、是否前台展示"AI 生成，仅供参考"提示、是否覆盖餐饮之外的本地生活品类、商业化路径。
