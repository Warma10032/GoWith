# AGENTS.md

> 给在本仓库工作的 AI Agent（包括 Claude Code、PR 自动化 Agent、CI 机器人、未来的领域 Agent）的统一行为规范。
> 本文件与 `CLAUDE.md` 配合：CLAUDE.md 描述"项目是什么、怎么开发"，AGENTS.md 描述"Agent 应当怎么工作、不应当越权什么"。
> 任何 Agent 在本仓库执行写操作前，必须先 Read `CLAUDE.md` 与 `docs/` 下四份文档的对应章节。

## 0. 强制前置阅读

每个 Agent 在第一次为本项目工作时，必须完成下列阅读并把它写进自己的 context：

| 文档 | 至少要读到 |
| --- | --- |
| `CLAUDE.md` | 全文 |
| `docs/PRD-bilibili-shop-map.md` | §1-§4 定位、§10 合规、§15 开放问题 |
| `docs/MVP-bilibili-shop-map.md` | §2 范围、§6 AI 流程、§9 推荐、§10 技术方案、§14 里程碑 |
| `docs/MVP-database-schema.md` | §3 ER、§4 枚举、§14 生命周期、§17 MVP 最小建表清单 |
| `docs/MVP-ai-workflow-and-admin-spec.md` | §1 原则、§3-§7 Schema、§10 校验、§13 状态流转 |

没有完成前置阅读的 Agent 不得动笔写业务代码、SQL 迁移、Prompt 或 Schema。

## 1. Agent 角色表

本项目的 Agent 按"职责边界"分工。每个 Agent 只对自己的产出负责，不跨层假设。

| 角色 ID | 负责范围 | 主要产出 | 不得做的事 |
| --- | --- | --- | --- |
| `schema-agent` | 数据库 Schema、迁移、索引、ER 图 | 4 个 migration SQL、状态枚举、索引 | 不写业务代码、不改 AI Prompt |
| `ingest-agent` | B站登录态、创作者、视频元信息、字幕、ASR、评论 | `bilibili_auth_accounts`、`creators`、`videos`、`video_text_assets`、`video_comments` 数据 | 不调 LLM；不绕过登录态做采集；不打印 Cookie |
| `ai-classify-agent` | 阶段 1：探店视频分类 | `video_classifications`、对应 `ai_runs` | 不抽店名、不做 POI；`confidence < 0.65` 必须 `need_manual_review = true` |
| `ai-extract-agent` | 阶段 2：视频级店铺候选抽取 | `shop_candidates`（不含 POI 匹配） | 不调高德、不输出 Markdown |
| `ai-comment-agent` | 阶段 3：评论线索增强 | `comment_signal_extractions` | 评论不能单独覆盖视频结论 |
| `ai-structure-agent` | 阶段 4：视频级结构化总结 | `ai_video_analyses`（schema `video_structured_analysis.v1`） | 不直接写 `shops`；不输出 Markdown |
| `poi-agent` | 阶段 5：高德 POI 匹配 | `poi_match_attempts`、`poi_match_candidates` | 坐标体系必须显式标注 `coord_type`；`shop_name_missing` / 同名分店多 / 搬迁风险必须 `need_review` |
| `publish-agent` | 视频→店铺聚合、合并、发布快照 | `shops`、`shop_video_mentions`、`shop_insights`、`published_shop_snapshots` | 必须读 `shops` 审核通过后才能写 `published_shop_snapshots.is_current = true` |
| `review-queue-agent` | `review_tasks` 生成、状态流转、审计 | `review_tasks`、`review_events` | 每次人工/AI 操作必须写 `review_events`；人工编辑优先级高于 AI |
| `recommend-agent` | 规则排序、推荐请求、行为埋点 | `recommendation_requests`、`recommendation_items`、`user_events` | 每次曝光必须带 `request_id`；`feature_snapshot` 必须落库 |
| `api-agent` | NestJS/Fastify API、OpenAPI 契约 | `apps/api/**`、`docs/openapi.yaml` | 不做 AI；不做前端 |
| `web-frontend-agent` | Next.js 用户端 + 后台 | `apps/web/**`、`apps/admin/**` | 不直连 DB；只调 API；高德 JS API Key 不能落到前端仓库外的配置 |
| `test-agent` | 单元/集成/E2E | `tests/**`、Playwright 套件 | 覆盖率 < 80% 不允许合入 `feat/*` 到 `main` |
| `compliance-agent` | B站协议、隐私、坐标体系、AI 声明 | 合规 checklist、风险 flag 评审 | 是 gate，可以 block 合并 |
| `docs-agent` | 文档、Schema 注释、API 文档 | `docs/**`、代码 docstring | 不写业务逻辑；不擅自改 `docs/MVP-*` 决策性章节 |

未来可扩展：`embedding-agent`（语义检索/推荐向量）、`user-profile-agent`（画像）、`merchant-claim-agent`（商家认领）。

## 2. Agent 通用规则

### 2.1 不变性（Immutability）

- 数据库层：永远 INSERT 新行 + 状态字段流转，不原地 UPDATE AI 输出原始 JSON。`ai_runs.output_payload`、`ai_video_analyses.analysis_json`、`evidence.text_excerpt` 一旦写入只读。
- 代码层：函数返回新对象，不修改入参；状态机推进走"创建新状态事件"而不是"覆盖旧状态"。
- 审核层：人工编辑后保留 `before_json` / `after_json` 到 `review_events`。

### 2.2 证据链（Evidence）

- 任何对用户可见的结论（卡片文案、推荐菜、避雷点、POI、店铺评价）必须能在 `evidence` 表找到至少一条 `evidence_ids`。
- 字幕 / ASR 为主证据；评论为辅证据；评论不能单独覆盖视频结论。
- 展示时强制显示"AI 总结，仅供参考"+ 证据入口。

### 2.3 unknown 原则

- AI 输出无证据时必须 `unknown` / `null` / `[]`，并在 `missing_fields` 或 `risk_flags` 显式说明。
- Agent 不得为了让卡片好看而"补全"店名、价格、地址、营业时间、推荐菜。

### 2.4 Prompt / Model 版本留痕

每次 AI 调用必须写入 `ai_runs`：

- `stage`（`classify_video` / `extract_shop_candidates` / `comment_signal` / `structure_video`）
- `provider` / `model` / `prompt_version`
- `input_hash`（输入文本 hash）
- `output_payload`（结构化 JSON）
- `usage`（token / 成本）
- `status`（`success` / `failed` / `invalid_json` / `schema_error`）

同一 `(stage, input_hash)` 应可重放；模型升级时 prompt 与 schema 同步升版（`schema_version`）。

### 2.5 坐标与地图

- 高德默认 GCJ-02；写 `pois.geom` 与 `shops.geom` 时必须带 `coord_type` 字段。
- 禁止把 WGS-84 / BD-09 直接当作 GCJ-02 写入；如需混用，必须显式转换后落 `wgs84_geom`。
- 地图视窗查询统一 `shops.geom && ST_MakeEnvelope(...)`；前端视窗坐标必须与 DB 同坐标系。

### 2.6 B站凭据

- `bilibili_auth_accounts.encrypted_cookie` 加密存储，绝不写日志、绝不在错误信息或回显中暴露。
- Agent 在调试 / 测试时只应使用 mock 数据集，不得在日志、测试夹具、commit 信息、Markdown 文档里出现真实 Cookie。
- 失败任务必须按 `error_code` 分类：登录失效 / 接口变更 / 权限不足 / 限流 / 网络错误。

### 2.7 成本与配额

- Groq：默认 `whisper-large-v3-turbo`；长视频需切片（free tier 25MB / dev tier 100MB）。
- 高德：基础搜索个人 5,000 / 月，企业 50,000 / 月，技术服务许可 500,000 / 月。POI 结果必须缓存 + 原始响应入库 `raw_ingest_payloads`。
- LLM：所有调用按 token 落 `ai_runs.usage`，便于后续成本看板。

## 3. 关键工作流

### 3.1 新增功能的标准流程

```
1. docs-agent：先在 docs/ 写或更新"为什么 + 接口契约 + Schema 变更"，再写代码。
2. planner / architect（人）：审 schema 与状态机是否与 docs/MVP-ai-workflow-and-admin-spec.md §3-§13 冲突。
3. schema-agent：写 migration，必须含 up / down 脚本 + 索引。
4. test-agent：先写 failing test（schema 校验、API 契约、AI 输出 JSON Schema、POI 阈值）。
5. 对应领域 agent：写最小实现让测试变绿。
6. compliance-agent：跑合规 checklist（B站 / 坐标 / AI 声明 / 隐私）。
7. docs-agent：把字段、状态机、API 更新同步进 docs/。
8. 提交 PR；CI 跑全量测试 + 覆盖率；review-queue-agent 监控审核队列是否合理。
```

### 3.2 AI 输出落库流程（必须严格按此顺序）

1. JSON parse（失败一次后重试，仍失败记 `ai_output_incomplete`）
2. Schema validate（`video_structured_analysis.v1` 等）
3. Enum validate（`content_type` / `sentiment` / `risk_flag` / `missing_field`）
4. Evidence validate（重要结论必须有 `evidence_ids`）
5. Risk rule evaluate（按 §10.2 幻觉拦截）
6. Generate `review_tasks`（按 `docs/MVP-database-schema.md` §14.2）
7. Save immutable raw output → `ai_runs.output_payload`
8. Save normalized result → `ai_video_analyses` / `shop_candidates` / `poi_match_candidates`

任意一步失败：写 `ai_runs.status` 失败原因 + 创建 `review_tasks` 任务，**不**继续下一步。

### 3.3 POI 匹配规则

| 条件 | 状态 | 是否进审核 |
| --- | --- | --- |
| `match_score >= 0.9` 且无风险 | `auto_matched` | 视 `risk_flags` 决定 |
| `0.65 <= match_score < 0.9` | `need_review` | 是 |
| `match_score < 0.65` | `low_confidence` | 不进前台 |
| 无候选 | `no_candidate` | 不进前台 |
| `shop_name_missing` / `generic_name_risk` / `closed_or_moved_mentioned` | 强制 `need_review` | 是 |

### 3.4 店铺合并 / 拆分

- 强匹配键：`pois.provider + pois.provider_poi_id`。
- 弱匹配：店名相似度 + 坐标距离（< 50m 可疑）+ 地址相似度。
- 合并优先走 `poi-agent` 提出的"疑似同店"任务 → `review-queue-agent` 排队 → 人工在合并页操作。
- 拆分：人工把合并后的 `shops` 拆回多个 `shops` + `shop_video_mentions` 重指；写 `review_events` 记录 `before` / `after`。

### 3.5 前台发布门槛（全部满足才能 `published`）

- `videos.is_shop_visit = true`
- 至少一个 `shop_candidates` 通过审核或 `auto_matched`
- 有有效 POI
- 有可展示卡片标题与推荐理由
- `shops.quality.shop_confidence >= 0.7`
- 无未处理高风险 `risk_flags`
- `published_shop_snapshots.is_current = true` 且 `version` 自增

### 3.6 推荐训练数据闭环

从第一天起，每次 `shop_card_impression` 必须写入 `user_events`，并带：

- `recommendation_request_id`（本次请求 ID）
- `recommendation_item_id`（本次曝光的 item ID）
- `surface`（`home` / `map` / `creator_page`）
- `event_payload`（位置、筛选条件、客户端类型）

`recommendation_items.feature_snapshot` 必须保存当时排序特征，禁止后续覆写。V0 规则阶段就该有数据。

## 4. 协作与冲突解决

### 4.1 跨 Agent 协作顺序

```
schema-agent  →  ingest-agent / ai-classify-agent / ai-extract-agent
            ↘
             publish-agent
            ↗
poi-agent  →  review-queue-agent  →  recommend-agent
                                          ↑
                                    web-frontend-agent / api-agent
```

- `schema-agent` 必须最先给到表与枚举，否则下游 Agent 无法落库。
- `publish-agent` 必须在 `review-queue-agent` 之后写 `published_shop_snapshots`。
- `recommend-agent` 只读 `shops(status = published)`，不能直读 AI 中间表。

### 4.2 冲突处理

- 多个 Agent 同时写同一 `entity_id` 时，必须有乐观锁（`updated_at` / `version`）或行级锁；冲突时第二个写入者必须重读 + 重校验。
- 同一 `video_id` 的 AI 阶段有并发风险：必须串行化（用 `jobs` 表的 `status = running` 锁或数据库 advisory lock）。
- 同一 `shop_candidate_id` 的 POI 重排：以最后一次 `ai_runs` 的 `created_at` 为准，前序 `match_status = selected` 改为 `rejected`。

## 5. 验证与质量门

每个 PR 触发以下 gate；不通过不允许 merge：

1. **Schema gate**：`psql --dry-run` 跑 migration + `schema-agent` 比对 ER 图。
2. **AI JSON gate**：所有 AI 测试用例的 `ai_runs.status` 必须为 `success` 且 `validation_status = valid`。
3. **POI gate**：单元测试覆盖 `auto_matched` / `need_review` / `low_confidence` / `no_candidate` 四态 + 强制审核场景。
4. **Privacy gate**：禁止在 diff、log、test fixture 中出现明文 Cookie / 手机号 / 邮箱。
5. **Coord gate**：所有 `pois` / `shops` 新增 row 必须有 `coord_type`。
6. **Evidence gate**：前台展示路径（首页 / 地图 / 详情）有专门的 Playwright 用例校验"AI 总结，仅供参考"提示 + 证据入口存在。
7. **Test coverage gate**：核心模块 ≥ 80%（详见 `docs/MVP-bilibili-shop-map.md` §12 指标体系）。
8. **Doc gate**：API 变更 / 状态机变更 / 新增枚举必须同步 `docs/MVP-*.md`。

## 6. 违规与回滚

| 违规行为 | 后果 | 回滚动作 |
| --- | --- | --- |
| 写日志 / 测试夹具中含明文 B站 Cookie | 立即 block + 凭据轮换 | 改密 + 重新登录态入库 + 清理 git history 中的暴露（filter-repo / BFG） |
| AI 输出含 `unknown` 但被强行补全 | 标记 `risk_flags = ai_output_incomplete` + 进入审核 | 删除 `shop_candidates`，重跑 AI |
| `shops.geom` 缺 `coord_type` | 阻止写入 / 触发迁移脚本补齐 | 全表 backfill + 应用层 strict 校验 |
| 跨层直读（前端直连 DB / 推荐服务直读 AI 中间表） | PR block | 引入 API / 物化视图层 |
| 覆盖率跌破 80% | CI fail | 补 test 或拆分大文件 |
| AI Schema 升级未带 `schema_version` 升版 | CI fail | 重跑 migration 记录升级，prompt 与 schema 同步 |

## 7. 不可做的事（项目红线）

1. **不**绕过 B站反爬、不模拟登录批量拉取、不缓存 / 重分发视频正文与评论原文。
2. **不**把 WGS-84 / BD-09 当 GCJ-02 写入 `geom`。
3. **不**让 AI 自由编造店名 / 地址 / 价格 / 推荐菜 / 营业状态；缺数据就 `unknown`。
4. **不**让评论单独覆盖视频结论。
5. **不**在公共日志或前端展示 `encrypted_cookie`、`session_token_hash`、`password_hash`。
6. **不**在 MVP 阶段做全站博主发现、商家入驻、交易闭环、App 原生端。
7. **不**把"AI 总结，仅供参考"提示去掉，证据入口必须可达。
8. **不**在 PR 中携带迁移导致的对 `ai_runs` / `evidence` 的"原地修改"——任何对历史 AI 输出的修正必须写新 `ai_runs` + `review_events`。

## 8. 沟通协议

- Agent 在群里 / commit / PR 描述里引用 entity 时必须用 `entity_type:entity_id` 形式（如 `video:01H...`、`shop_candidate:01H...`），避免自然语言歧义。
- Bug / 风险升级：自动开 `review_tasks` + 在 `risk_flags` 添加 `needs_manual_review`，不要直接 ping 真人。
- 决策性改动（Schema 增删字段、状态机变更、推荐算法升级、POI 阈值调整）必须在 `docs/MVP-*.md` 留 PR 链接，不允许"代码 + 文档"分裂。

---

> 本文件随项目演进；任何新增 Agent 角色、新增红线、新增 gate，必须先在本文件提 PR，由 `docs-agent` + 至少一名领域 Agent 共同 review 后落地。
