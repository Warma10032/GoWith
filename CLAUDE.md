# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

GoWith 是"B站探店博主店铺地图集"——以 B站探店 UP 主为索引，将视频内容转化为全国可检索店铺情报的决策平台。产品形态为 Web 端 (Next.js)，核心闭环为：种子博主 → B站数据采集 → AI 视频理解 → 高德 POI 匹配 → 后台审核 → 前台店铺卡片 / 地图 / 博主页展示 → 用户行为沉淀 → 推荐迭代。

文档目录：`docs/` 下五份文档相互引用，必须同时阅读：

- `docs/PRD-bilibili-shop-map.md` —— 长期产品定位、用户场景、信息架构、推荐策略、技术栈、数据模型初稿、合规风险。
- `docs/MVP-bilibili-shop-map.md` —— MVP 范围、种子博主、数据采集、AI 工作流总览、推荐 MVP、技术方案、里程碑、当前实现状态。
- `docs/MVP-ai-workflow-and-admin-spec.md` —— AI 各阶段 JSON Schema（视频分类、评论线索、视频结构化分析、POI 匹配、发布快照）、校验规则、后台页面字段、审核动作状态机。
- `docs/MVP-database-schema.md` —— PostgreSQL/PostGIS 完整表结构、索引、ER 图、读路径、迁移说明、与 `packages/db` Kysely schema 的差异。
- `docs/openapi.yaml` —— MVP 阶段实现的 REST API 契约（公共 + admin）。

## 当前实现状态（2026-06-28）

仓库已 **Hard cut 到真实集成模式**：所有 adapter（`apps/worker/src/adapters/bilibili.ts`、`poi.ts`）和 AI worker（`apps/ai-worker/app/main.py`）都直接走真实外部 API，不再有 `EXTERNAL_MODE` 切换开关或 mock 兜底。运行时缺失 key 会立刻抛错并把任务标记为 `failed` / `metadata_failed`。

里程碑落地：

- **M0 脚手架 + Mock 闭环 ✅**（2026-06-17 完成）：monorepo、6 个 SQL migration、Fastify API、BullMQ pipeline、FastAPI AI Worker、Next.js 用户端 + 后台、单一 E2E + 单元测试骨架。
- **M1 数据采集跑通 ✅**（2026-06-28）：B 站 adapter 改为真实 HTTP（WBI 签名、Cookie 池、429 自适应限流、播放地址备份 fallback、`metadata_failed` 状态、增量同步）；Groq Whisper ASR 接入（`whisper-large-v3-turbo`、长音频 ffmpeg 切片 + 重叠转写）；评论样本热评 + 最新混合抽样；B 站 Cookie 加密落库（`AES-256-GCM` + key_id envelope 轮换）。
- **M2 AI 视频理解跑通 ✅**（2026-06-28）：AI Worker 接 MiniMax LLM（OpenAI-compatible SDK）+ Groq Whisper，5 阶段管线全部走真实模型；`prompt_version` + `input_hash` 写入 `ai_runs`；Zod + Pydantic 双层校验；OAI 错误分类 → `ai_runs.status ∈ {success, failed, invalid_json, schema_error}`。
- **M3 POI 与后台跑通 🟡 部分**：高德 `v5/place/text` 已接，dice 相似度 + 6 信号重排；`shop_candidates.status` 在 `auto_matched` / `need_review` / `extracted` 之间流转；后台审核、POI 修正、`POST /api/admin/shops/:id/publish` 事务 + 快照、`POST /api/admin/shops/merge` 占位；后台回收站 + 软删除 + 定时清理已落地（migration 007/008/009）。
- **M4 前台 MVP 🟡 部分**：首页 / 地图 / 博主 / 详情 / 后台五大页面可用；首页接入 V0 规则推荐 + 浏览器定位 (`distance_v1`)；地图页当前为 placeholder 网格（高德 JS API 待接）。
- **M5 推荐数据闭环 🟡 部分**：V0 规则推荐 + `recommendation_items.feature_snapshot` + `user_events` 落表 + 限速；排序模型与训练样本导出待做。
- **生产安全加固 🟢 全部完成**：见下文 §安全加固。

最新提交：`ece6170 docs: B 站增量同步 + metadata_failed 状态文档化` / `7a2cc4e feat(worker): 集成 planCreatorVideoSync + 任务 partial failure 状态` / `d442321 feat(worker): B 站 API 自适应限速 + 全局请求节流`。

## 仓库结构

pnpm workspaces monorepo（`pnpm-workspace.yaml`）：

```
.
├── apps/
│   ├── api/          # Fastify API 服务（端口 +10000 偏移）
│   ├── web/          # Next.js 15 前端 + /admin 后台（端口 +10000 偏移）
│   ├── worker/       # BullMQ 消费者：5 阶段 AI 管线 + POI 匹配 + 定时任务调度
│   └── ai-worker/    # FastAPI AI/ASR 服务（端口 +10000 偏移），uv 管理依赖
├── packages/
│   ├── db/           # Kysely 客户端 + DB 类型（与 SQL 有差异，见 §数据库）
│   └── shared/       # 共享 Zod schema + 枚举 + 校验工具
├── db/migrations/    # 9 个顺序 SQL 迁移文件
├── scripts/
│   ├── migrate.ts    # 顺序应用迁移，建 schema_migrations 表追踪
│   └── seed-admin.ts # 幂等创建 ADMIN_EMAIL 管理员账号
├── tests/e2e/        # Playwright smoke
├── docs/             # PRD / MVP / Schema / AI spec / OpenAPI / 安全报告
├── docker-compose.yml # postgres:postgis:16-3.4 + redis（内网化，强密码）
├── .env.example      # 所有外部 key 占位符，无真实凭据
└── package.json      # pnpm + concurrently 启动 web/api/worker/ai
```

## MVP 范围与不做事项

MVP 仅围绕首批 5 个种子博主（UID: `3546888255048212`、`99157282`、`1781681364`、`544336675`、`8263502`）的全部视频做数据闭环验证，不做全站博主发现。

MVP 必做：博主种子库、B站登录态服务端维护、视频元信息同步、字幕 / Groq Whisper ASR、评论样本、AI 五阶段工作流（MiniMax LLM）、高德 POI 匹配、后台审核、Web 端首页 / 地图 / 博主 / 店铺详情 / 后台、用户行为埋点。

MVP 不做：全站探店博主发现、商家入驻、团购 / 交易、完整社交、App 原生端、复杂深度学习模型线上服务。

## 核心技术选型

| 层               | 选型                                                                                                                                | 实现位置                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 前端             | Next.js 15 App Router + React + TypeScript；Tailwind CSS；lucide-react 图标；后台 SSE 实时任务状态                                    | `apps/web/`                                           |
| API 服务         | **Fastify** + TypeScript；@fastify/cookie / cors / swagger(-ui) / helmet；Zod 入参校验；bcryptjs；AES-256-GCM 凭据加密（key_id envelope）；Kysely | `apps/api/`                                           |
| 后台 Worker      | Node.js + BullMQ + Redis（ioredis 共享）；Kysely；Zod；内置定时任务调度器                                                            | `apps/worker/`                                        |
| AI / 数据 Worker | **FastAPI**（Python 3.11+）；Pydantic v2；uv 管理依赖；mypy strict；ruff；OpenAI SDK 接 MiniMax                                        | `apps/ai-worker/`                                     |
| 数据库           | PostgreSQL 16 + PostGIS、pgcrypto、pg_trgm；schema 由 9 个 migration 落地                                                           | `db/migrations/`                                      |
| 共享层           | `@gowith/shared`（Zod schema、枚举）+ `@gowith/db`（Kysely client + DB 类型）                                                       | `packages/`                                           |
| 任务队列         | BullMQ + Redis；DB `jobs` + `pipeline_runs` / `pipeline_events` 双写                                                                 | `apps/api/src/services/queue.ts` + `apps/worker/src/` |
| 缓存             | Redis（Docker Compose 启动；仅监听内网）                                                                                              | `docker-compose.yml`                                  |
| LLM              | **MiniMax**（`MINIMAX_*`，OpenAI-compatible）；`MINIMAX_MODEL=MiniMax-M3`；可选复杂阶段走 `MiniMax-M3`、简单阶段走 `MiniMax-M2.7`        | `apps/ai-worker/app/main.py`                          |
| ASR              | **Groq Whisper**（`whisper-large-v3-turbo`，重识别时切 `whisper-large-v3`）；ffmpeg 切 16KHz mono FLAC + 按 25MB 重切片             | `apps/ai-worker/app/main.py`                          |
| 地图             | **高德 Web Service** `v5/place/text` + 高德 JS API（前台地图页待接）；保留 provider 抽象                                            | `apps/worker/src/adapters/poi.ts`                     |
| B 站             | 真实 HTTP + WBI 签名 + Cookie 池（多账号） + 全局请求节流（429 自适应） + 风控分类                                                  | `apps/worker/src/adapters/bilibili.ts`                |
| 浏览器测试       | Playwright（使用本地 Chrome 通道，不需要下载 Chromium）                                                                             | `tests/e2e/`                                          |
| Python 测试      | pytest + FastAPI TestClient                                                                                                         | `apps/ai-worker/tests/`                               |

## 真实集成模式（无 mock fallback）

`apps/worker/src/adapters/bilibili.ts` 直接调 `api.bilibili.com`（WBI 签名、Cookie 池、AES-256-GCM 解密、`metadata_failed` 错误分类、429 自适应限流 + 全局请求节流）。`apps/worker/src/adapters/poi.ts` 直接调 `restapi.amap.com/v5/place/text`，缺失 `AMAP_WEB_SERVICE_KEY` 立刻抛错。`apps/ai-worker/app/main.py` 通过 OpenAI SDK 调 MiniMax、调 Groq Whisper，缺失 `MINIMAX_API_KEY` / `GROQ_API_KEY` 抛 `500 minimax_api_key_missing` / `groq_api_key_missing`。**`EXTERNAL_MODE` 变量与 fixture mock 文件已全部删除。**

凭据管理：`.env`（本地）+ 生产用 secrets manager（参见 `docs/security-public-deployment-report.md`）。

## AI 工作流（五阶段管线）

所有 AI 输出必须结构化 JSON、可追溯到证据、缺失即输出 `unknown`。管线为：

```
Video Metadata + Subtitle/ASR + Comment Sample
  → 探店视频分类（classify_video，prompt_version: classify_video.v1）
  → 视频级店铺候选抽取（extract_shop_candidates，prompt_version: extract_shop_candidates.v1）
  → 评论区店铺线索增强（comment_signal，prompt_version: comment_signal.v1）
  → 视频级结构化总结（structure_video，schema_version: video_structured_analysis.v2）
  → 高德 POI 匹配（query_strategy: city_name_keyword，本地重排打分）
  → 后台审核 / 自动发布
```

实际编排位置：`apps/worker/src/jobs/pipeline.ts` 的 `handlePipelineJob`，每个阶段：

1. 写 `ai_runs`（`status='success'` 或 `failed/invalid_json/schema_error`，记录 `provider='minimax'`、`model_version` 如 `MiniMax-M3` / `MiniMax-M2.7`、`prompt_version`、`input_hash`）
2. 调用 `apps/ai-worker` HTTP 端点（`/ai/classify-video` / `/ai/extract-shop-candidates` / `/ai/comment-signals` / `/ai/structure-video`），由 AI worker 内部带 `Authorization: Bearer ${AI_WORKER_SHARED_SECRET}`
3. 用 `@gowith/shared` 的 Zod schema（`videoClassificationResultSchema` / `commentSignalExtractionSchema` / `videoStructuredAnalysisSchema`）校验
4. 写入对应业务表（`video_classifications` / `comment_signal_extractions` / `ai_video_analyses` / `shop_candidates`）
5. 自动开 `review_tasks`，对 `risk_flags` 非空的候选置 `priority=80`

POI 匹配：`matchPoiJob` 调 `searchAmapPoi` → upsert `pois`（强匹配键 `provider+provider_poi_id`）→ 写 `poi_match_attempts` + `poi_match_candidates` → dice 相似度 + 6 信号加权打分（name 0.46 / city 0.16 / district 0.10 / business_area 0.08 / address 0.12 / category 0.08）。`score ≥ 0.9` 且无风险 → `auto_matched` + `shop_candidates.status='poi_matched'`；否则 `need_review` / `low_confidence` / `no_candidate`（强制 `poi_match_need_review` 触发条件：店名缺失 / 同名候选 ≥ 2 / 风险标记含 `closed_or_moved_mentioned`）。

关键约束（详见 `docs/MVP-ai-workflow-and-admin-spec.md` §1.1 + `packages/shared/src/validation.ts`）：

- AI 不输出 Markdown / 自由文本，只输出 JSON。
- 信息不足时输出 `unknown` / `null` / `[]`，并在 `missing_fields` 或 `risk_flags` 标记。
- 每个重要结论必须绑定 `evidence_ids`；字幕/ASR 为主证据，评论为辅，评论不能单独覆盖视频结论。
- 视频级结果先产出，再聚合到 `Shop`。
- 低置信度结果进后台，不进前台推荐。
- `prompt_version`、`model_version`、`input_hash` 必须留痕以便回放和模型评估。
- 结构化校验失败 → `ai_runs.status='schema_error'` + 创建 `review_tasks`。

POI 匹配阈值：

| match_score                      | 状态               | `shop_candidates.status` 终态                       |
| -------------------------------- | ------------------ | --------------------------------------------------- |
| `>= 0.9` 且无风险                | `auto_matched`     | `poi_matched`                                       |
| `0.65 <= score < 0.9`            | `need_review`      | `poi_match_need_review`                             |
| `< 0.65`                         | `low_confidence`   | `poi_match_low_confidence`（worker 当前未显式设置） |
| 无候选                           | `no_candidate`     | `extracted` 不动                                    |
| 店名缺失 / 同名分店多 / 搬迁风险 | 强制 `need_review` | `poi_match_need_review`                             |

前台发布门槛：`is_shop_visit = true`、至少一个候选通过审核、有有效 POI、有推荐文案、`shop_confidence >= 0.7`、无未处理高风险标记。`apps/api/src/routes/admin.ts` 的 `POST /api/admin/shops/:id/publish` 在事务里把旧快照 `is_current` 置 false、写新版本 + 自增 `version`、把 `shops.status` 置 `published`。

## 数据架构核心约束

读 `docs/MVP-database-schema.md` §3 ER 图与 §14 生命周期。重要分层原则：

- **原始数据 / 中间结果 / 人工审核 / 前台发布四层分表保存**。`shop_candidates` ≠ `shops`；候选经 POI 匹配 + 审核才成为正式店铺。
- **AI 输出保留原始 JSON** 在 `ai_runs.output_payload` 和 `ai_video_analyses.analysis_json`，便于调试、回放、模型评估。
- **前台只读 `shops` 和 `published_shop_snapshots`**，不直接读未审核 AI 中间表。
- **后台删除统一为软删除**：`creators` / `videos` / `shops` 写入墓碑字段并进入回收站（migration 007）；公共查询强制排除 `deleted_at IS NOT NULL`，原始 AI 输出、证据和发布快照不得级联删除。
- **人工修订不覆盖外部来源**：博主和视频使用 override 字段；店铺当前展示内容可人工编辑，但每次修改必须写 `review_events`。
- **POI 强匹配键 = `provider + provider_poi_id`**，坐标体系（GCJ-02 / BD-09 / WGS-84）必须在 `pois.coord_type` 显式标记，禁止混用。
- **推荐训练数据从第一天记录**：所有曝光 / 点击必须带 `recommendation_request_id` 和 `recommendation_item_id`，`recommendation_items.feature_snapshot` 必须保存当时排序特征。

视频到店铺的完整链路：`creators → videos → video_text_assets / video_comments → ai_runs → ai_video_analyses → shop_candidates → poi_match_attempts / poi_match_candidates → shops → shop_video_mentions → published_shop_snapshots`。

地图视窗查询统一走 `shops.geom && ST_MakeEnvelope(...)`，`geom` 存 GCJ-02 时前端必须传同坐标系视窗。`apps/api/src/routes/public.ts` 的 `/api/shops/map` 即此实现。

迁移按九个文件推进：①扩展 + 基础表 → ②AI 与候选店铺表 → ③POI/shops/review 表 → ④推荐日志表 → ⑤高德商业字段与外部平台链接 → ⑥移除 AI 人均字段 → ⑦admin 回收站 + overrides → ⑧定时任务 run_type → ⑨repair 已完成 scheduled_cleanup run。注意 003 里 `shop_candidates.selected_poi_id` / `shop_candidates.merged_shop_id` / `evidence.shop_id` 的 FK 必须在 shops / pois 建好之后用 `ALTER TABLE ... ADD CONSTRAINT` 添加。

### `packages/db/src/schema.ts` 与 SQL 的已知差异

`packages/db/src/schema.ts` 是 Kysely 类型镜像，部分表与 SQL 实际定义不一致，**M3 接真实审核 + `review_events` 写入前必须修复**：

| 表                    | TS 类型                                                                                 | SQL 实际                                                                                                                  | 差异                    |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `shop_video_mentions` | `mention_type: "primary" \| "secondary" \| "comparison"`、`no sentiment/summary/time_*` | `mention_type text DEFAULT 'main'`、有 `sentiment`/`summary`/`time_start_sec`/`time_end_sec`、`shop_candidate_id`         | 字段缺失、枚举值不同    |
| `shop_insights`       | `insight_type`、`payload jsonb`、`source_video_ids`、`source_comment_ids`               | `dimension`、`sentiment`、`summary`、`confidence`、`source_type`、`source_ids`、`evidence_ids`、`model_version`、`status` | 字段命名 / 含义完全不同 |
| `review_events`       | `task_id`、`actor_id`、`note`                                                           | `review_task_id`、`reviewer_id`、`reason`                                                                                 | 字段命名不同            |
| `shop_aliases`        | 无 `confidence`                                                                         | 有 `confidence numeric(4,3)`                                                                                              | 缺字段                  |

`apps/worker` 当前不写 `shop_insights` 和 `review_events`，所以这些差异不会立即爆炸；但接真实人工审核路径前必须先同步 TS 类型。

## B站数据采集要点

- 服务端统一维护登录态，Cookie AES-256-GCM 加密存 `bilibili_auth_accounts.encrypted_cookie`（加密实现 `apps/api/src/services/crypto.ts`，P2-2 加了 `key_id` envelope 方便后续 key rotation）。
- 民间 API 文档仅作内部验证参考；上线产品需重新评估 B站平台协议、授权、展示边界。
- 视频同步分四类独立任务：元信息、字幕、ASR、评论；每任务有状态、重试次数、错误原因（`login_expired` / `risk_control` / `wbi_signature_failed` / `rate_limited` / `permission_denied` / `video_unavailable` / `network_error`）。单个失败视频置 `metadata_failed`，下次增量只重跑失败 + 新发现视频，不重跑全量。
- ASR：长视频需 ffmpeg 切 16KHz mono FLAC（`_prepare_audio_chunks`，按 `GROQ_ASR_MAX_MB` 自动再切片）；Groq free tier 文件上限 25MB，dev tier 100MB，应用层 `ASR_MAX_UPLOAD_MB` 兜底。
- 评论样本采用热评（`mode=3`）+ 最新评论（`mode=2`）+ 关键词评论混合抽样；评论用户信息保存 `user_hash`（SHA256(mid)），不默认前台展示原文。
- 全局请求节流（`waitForGlobalBilibiliThrottle`）：基线 `BILIBILI_REQUEST_INTERVAL_MS=1200`，遇 429 翻倍直到 `BILIBILI_MAX_REQUEST_INTERVAL_MS=15000` 顶到 cooldown `BILIBILI_RATE_LIMIT_COOLDOWN_MS=60000`，成功后按 0.9x 退避。
- WBI 签名：mixin key 表 + md5(`wts` + 排序 query + mixin_key) → `w_rid`；遇 `v_voucher` 自动失效缓存重试一次。

## 高德地图成本与配额

基础搜索服务：个人认证 5,000 次/月，企业认证 50,000 次/月，技术服务许可 500,000 次/月。流量包 30 元/万次。`searchAmapPoi` 写原始响应到 `raw_ingest_payloads`（按 `request_hash` 去重），便于排查和降本。

## 后台审核设计

一人使用后台。前端入口：`apps/web/src/app/admin/page.tsx`（`AdminConsole` 组件）。后台已实现：

- 登录页（邮箱 + 密码，bcryptjs 校验，httpOnly cookie `gowith_session`，30 天有效，登录限速 + 失败锁定 P0-2）
- 数据后台仪表盘（博主 / 视频 / 候选店铺 / 审核任务 / 已发布店铺 + 回收站）
- B站 Cookie 加密保存（`POST /api/admin/bilibili-auth`，多账号 + 健康检查 + 风控标记）
- 博主管理（新增 / 同步触发 / 软删除）
- 视频任务列表（含 `metadata_failed` 复跑按钮）
- 候选店铺列表（POI 搜索 + 驳回 + 提交复审）
- 已入库店铺列表（发布 / unpublish / 编辑）
- 回收站 + 定时清理 UI（migration 008/009）

每次人工操作必须写 `review_events` 审计日志（含 `before_json` / `after_json` / `reviewer_id` / `reason`），人工编辑优先级高于 AI 和自动 POI 匹配，可回滚。**注意**：`packages/db/src/schema.ts` 中 `review_events` 字段名为 `actor_id` / `note`，与 SQL 的 `reviewer_id` / `reason` 不一致，M3 接真实审核前必须统一。

自动生成 `review_tasks` 的触发条件见 `docs/MVP-database-schema.md` §14.2：分类置信度低、店名缺失、generic_name 风险、多店铺、POI 无候选 / 低置信 / 同名候选多、评论提搬迁闭店、AI 校验失败。`apps/worker/src/jobs/pipeline.ts` 在 `risk_flags.length > 0` 时开 `poi_review` 任务、否则开 `shop_candidate_review`。

后台定时任务：worker 内置 `scheduler.ts` + `scheduled_task_runs` 表，按 `run_type` 触发（B 站 Cookie 池健康检查、过期账号清理、`cleanup` 等），可在 admin UI 触发 + 查看历史。

## 推荐系统 MVP

`apps/api/src/routes/public.ts` 的 `/api/shops/recommended` 当前实现 V0 规则排序 + `distance_v1` 距离模式：

1. 写 `recommendation_requests`（`algorithm ∈ {'rule_v0', 'distance_v1'}`）
2. V0：取所有 `shops.status='published'` 按 `published_at DESC LIMIT 30`；distance_v1：先按浏览器 WGS-84 定位转换到 GCJ-02 后用球面距离排序
3. 按 `1/rank` 打分写入 `recommendation_items`，`reason_codes=['published_recently', 'rule_v0']` 或 `['distance_v1', 'browser_geolocation']`，`feature_snapshot={shop_confidence, published_at, distance_m}`
4. 返回 items 并带 `recommendation_item_id`，前端埋点可回溯推荐上下文

从第一天记录埋点事件：`shop_card_impression` / `shop_card_click` / `shop_detail_view` / `map_pin_click` / `creator_filter_apply` / `favorite_shop` / `want_to_go` / `navigation_click` / `video_source_click` / `negative_feedback`。每次曝光带 `request_id`，行为可回溯推荐上下文。埋点接口 P1-4 加了限速 + payload 枚举 / 大小 / 深度限制。

演进路线：V0 规则 → V1 LightGBM/XGBoost Ranker → V2 双塔召回 → V3 DeepFM/DCN/DIN 多目标排序。MVP 阶段重点是保证数据结构和日志可训练。

## 安全加固（已落地）

按 `docs/security-public-deployment-report.md` 推进的 P0/P1/P2 系列修复，已 100% 关闭：

- **P0-1 生产 secret 强校验**：env 启动时校验 `AUTH_SECRET` / `COOKIE_ENCRYPTION_KEY` / `AI_WORKER_SHARED_SECRET` / DB 密码，placeholder / dev fallback / 短长度在生产直接抛错拒启。
- **P0-2 登录限速 + 失败锁定 + 共享 ioredis**：`apps/api/src/services/rate-limit.ts` + `apps/api/src/services/auth.ts`；`LOGIN_RATE_LIMIT_MAX=5 / WINDOW=900000ms / LOCKOUT=1800000ms`。
- **P0-3 CSRF 防护**：管理后台写操作走双提交 cookie + Origin 校验，`CSRF_PROTECTION_ENABLED`（生产自动 true，dev 默认 false）。
- **P0-4 AI Worker 内部 shared secret 鉴权**：`AI_WORKER_SHARED_SECRET` Bearer token + dev 缺省放行 / 生产强制校验。
- **P0-5 PostgreSQL / Redis / AI Worker 内网化 + 强密码**：`docker-compose.yml` 改用 `${POSTGRES_PASSWORD:?}` / `${REDIS_PASSWORD:?}`，端口仅 127.0.0.1 bind。
- **P0-6 图片下载 SSRF + SVG 防护**：`apps/worker/src/services/image-downloader.ts`，白名单域名 + 拒绝内网 / 环回 / metadata IP + SVG 不解析为图片。
- **P1-1 生产错误脱敏**：Fastify `errorHandler` 隐藏 stack / SQL；Swagger UI 仅 dev。
- **P1-2 Swagger UI 仅 dev**：`docs` 路由生产返回 404。
- **P1-3 SSE CORS 修复**：credentials + origin 白名单。
- **P1-4 埋点接口限速 + payload 校验**：枚举 / 大小 / 深度限制（`packages/shared/src/api.ts`）。
- **P1-5 ASR 上传 body 兜底**：应用层 `ASR_MAX_UPLOAD_MB` 流式截断。
- **P2-1 / P2-2 / P2-3 / P2-4**：Cookie 加密加 `key_id` envelope 支持轮换；web 安全响应头（CSP / HSTS / X-Frame / nosniff / Referrer / Permissions）；poi.ts 错误信息不直接回显含 key 的 URL；`apps/worker/src/services/log-redact.ts` 第三方 key 日志脱敏。

## 合规风险与红线

- 优先展示跳转 B站原视频，不搬运视频内容；AI 总结以摘要和观点聚合为主，避免复制大段原文。`apps/web/src/components/shop-card.tsx` 与 `apps/web/src/app/shops/[id]/page.tsx` 已显示 "AI 总结，仅供参考"。
- 评论区只做聚合洞察，不默认公开评论用户信息；高风险负面结论必须进入审核。
- 不绕过反爬、模拟登录批量拉取；上线前必须法务评估 B站数据采集、评论处理、视频摘要的协议与版权边界。
- 国内地图使用 GCJ-02 坐标系；混用 WGS-84/BD-09 必须显式坐标转换和来源标记。
- 所有 AI 结论展示"AI 总结，仅供参考"，必须能查看来源。

## 常用命令

环境前提：Node.js 20+、Python 3.11+、PostgreSQL 16+（含 PostGIS）、Redis 7+（Docker Compose 自带）、uv（Python 包管理）。

初始化（一次性）：

```bash
cp .env.example .env             # 含真实集成默认值，按需替换真实 key
pnpm install
uv sync --project apps/ai-worker --extra dev --link-mode=copy
docker compose up -d postgres redis
pnpm db:migrate                  # 顺序应用 db/migrations/*.sql
pnpm db:seed                     # 幂等创建 ADMIN_EMAIL 管理员（密码 = ADMIN_INITIAL_PASSWORD）
```

日常开发：

```bash
pnpm dev                         # concurrently 启动 web + api + worker + ai-worker
pnpm dev:web                     # 仅 Next.js
pnpm dev:api                     # 仅 Fastify API
pnpm dev:worker                  # 仅 BullMQ worker
pnpm dev:ai                      # 仅 FastAPI ai-worker（uv run uvicorn）
```

测试与质量门：

```bash
pnpm test                        # 各 workspace vitest
pnpm test:py                     # pytest（ai-worker）
pnpm test:e2e                    # Playwright（用本地 Chrome 通道）
pnpm lint                        # pnpm -r lint
pnpm typecheck                   # pnpm -r typecheck（tsc --noEmit）
pnpm lint:py                     # ruff check apps/ai-worker
pnpm typecheck:py                # mypy --strict apps/ai-worker/app
pnpm format / pnpm format:write  # Prettier
```

构建：

```bash
pnpm build                       # pnpm -r build（web/api/worker 各 workspace）
```

数据库细节：

```bash
psql -d gowith -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
# 注意：db/migrations/001_extensions_and_base.sql 已经在文件内执行 CREATE EXTENSION，无需手动。
```

默认端口（统一到 +10000 高位偏移，便于跨平台 / Docker / 本地共用）：

- Web: http://localhost:13000
- API: http://localhost:14000（Swagger UI: `/docs`，仅 dev）
- AI Worker: http://localhost:18000
- Postgres: localhost:15432（容器内仍 5432，PG 镜像硬编码）
- Redis (Docker Compose): localhost:16379（容器内仍 6379）

历史背景：Windows Hyper-V 保留 TCP 2970-3069 / 3070-3169 / 13396-13495 等段，所以 3000/4000/8000 都不能直 bind；统一到高位 +10000 偏移后全平台干净。

## 开发里程碑

按 `docs/MVP-bilibili-shop-map.md` §14：

- **M0 脚手架 + Mock 闭环** ✅ 已完成（2026-06-17）：monorepo 脚手架、6 migration、API + Worker + AI Worker + Web + 后台全部可用。
- **M1 数据采集跑通** ✅ 已完成（2026-06-28）：B 站真实 HTTP（WBI + Cookie 池 + 429 节流 + 风控 + `metadata_failed` + 增量）、Groq Whisper ASR、长音频切片、评论样本混合抽样。
- **M2 AI 视频理解跑通** ✅ 已完成（2026-06-28）：MiniMax LLM 接通，5 阶段管线 + `prompt_version` + `input_hash` + Zod/Pydantic 双层校验。
- **M3 POI 与后台** 🟡 部分：真实高德 POI 搜索 + dice 重排 + 后台审核 / 合并 / 发布 / 软删除 / 回收站；剩余：`shop_insights` / `review_events` 接入人工路径，TS schema drift 修复。
- **M4 前台 MVP** 🟡 部分：首页 / 地图 / 博主 / 详情 / 后台可用；地图页 placeholder 网格待接高德 JS API；用户端登录待做。
- **M5 推荐数据闭环** 🟡 部分：V0 规则推荐 + `distance_v1` + 埋点 + 限速；剩余：排序模型 / 双塔召回 / 训练样本导出。

## MVP 验收指标

数据链路：5 个博主全量视频同步成功率 ≥ 90%；有字幕或 ASR 文本的视频占比 ≥ 80%；探店分类抽检准确率 ≥ 85%；候选抽取抽检准确率 ≥ 75%；高德 POI 人工确认准确率 ≥ 80%；AI 结构化 JSON 校验通过率 ≥ 95%。
产品链路：首页 / 地图 / 博主 / 店铺详情 / 后台五大功能可用。
推荐链路：行为日志完整、每次曝光有 `request_id`、点击 / 收藏 / 导航可回溯推荐上下文。

## 开放问题（需先确认再动工）

PRD §15 与 MVP §15 列出 15+ 待确认问题，关键几条：产品名是否确定为 GoWith、Web 登录方式（当前仅 admin）、首页默认推荐按博主优先还是城市优先（已支持浏览器定位 + `distance_v1`）、是否覆盖餐饮之外的本地生活品类、商业化路径。