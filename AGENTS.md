# AGENTS.md

> 给在本仓库工作的 AI Agent（包括 Claude Code、PR 自动化 Agent、CI 机器人、未来的领域 Agent）的统一行为规范。
> 本文件与 `CLAUDE.md` 配合：CLAUDE.md 描述"项目是什么、怎么开发"，AGENTS.md 描述"Agent 应当怎么工作、不应当越权什么"。
> 任何 Agent 在本仓库执行写操作前，必须先 Read `CLAUDE.md` 与 `docs/` 下五份文档的对应章节。

## 0. 强制前置阅读

每个 Agent 在第一次为本项目工作时，必须完成下列阅读并把它写进自己的 context：

| 文档 | 至少要读到 |
| --- | --- |
| `CLAUDE.md` | 全文（含仓库结构、外部模式、命令、AGENTS.md 已知 schema drift） |
| `docs/PRD-bilibili-shop-map.md` | §1-§4 定位、§10 合规、§15 开放问题 |
| `docs/MVP-bilibili-shop-map.md` | §2 范围、§6 AI 流程、§9 推荐、§10 技术方案、§14 里程碑、§15 当前实现状态 |
| `docs/MVP-database-schema.md` | §3 ER、§4 枚举、§14 生命周期、§17 MVP 最小建表清单、§19 schema drift |
| `docs/MVP-ai-workflow-and-admin-spec.md` | §1 原则、§3-§7 Schema、§10 校验、§13 状态流转 |
| `docs/openapi.yaml` | 公共 + admin 全部路径（看 Request/Response 是否对齐你的产出） |

没有完成前置阅读的 Agent 不得动笔写业务代码、SQL 迁移、Prompt 或 Schema。

## 1. Agent 角色表

本项目的 Agent 按"职责边界"分工。每个 Agent 只对自己的产出负责，不跨层假设。**当前已实现的 monorepo 布局**：`apps/{api,web,worker,ai-worker}` + `packages/{db,shared}` + `db/migrations/*` + `scripts/*` + `tests/e2e/*`。

| 角色 ID | 负责范围 | 主要产出 | 不得做的事 |
| --- | --- | --- | --- |
| `schema-agent` | 数据库 Schema、迁移、索引、ER 图、**`packages/db/src/schema.ts` 与 SQL 的同步** | 4 个 migration SQL、`set_updated_at()` 触发器、状态枚举、PostGIS 索引、Kysely DB 类型 | 不写业务代码；不改 AI Prompt；不擅自命名不一致字段（详见 §6） |
| `ingest-agent` | B站登录态、创作者、视频元信息、字幕、ASR、评论 | `bilibili_auth_accounts`、`creators`、`videos`、`video_text_assets`/`segments`、`video_comments` | 不调 LLM；不绕过登录态做采集；不打印 Cookie；M0 阶段 `apps/worker/src/adapters/bilibili.ts` 用确定性 fixture，M1 替换为真实 HTTP |
| `ai-classify-agent` | 阶段 1：探店视频分类 | `video_classifications`、对应 `ai_runs` | 不抽店名、不做 POI；`confidence < 0.65` 必须 `need_manual_review = true` |
| `ai-extract-agent` | 阶段 2：视频级店铺候选抽取 | `shop_candidates`（不含 POI 匹配） | 不调高德、不输出 Markdown |
| `ai-comment-agent` | 阶段 3：评论线索增强 | `comment_signal_extractions` | 评论不能单独覆盖视频结论 |
| `ai-structure-agent` | 阶段 4：视频级结构化总结 | `ai_video_analyses`（schema `video_structured_analysis.v1`） | 不直接写 `shops`；不输出 Markdown |
| `poi-agent` | 阶段 5：高德 POI 匹配 | `poi_match_attempts`、`poi_match_candidates`、upsert `pois` | 坐标体系必须显式标注 `coord_type`；`shop_name_missing` / 同名分店多 / 搬迁风险必须 `need_review` |
| `publish-agent` | 视频→店铺聚合、合并、发布快照 | `shops`、`shop_video_mentions`、`shop_insights`、`published_shop_snapshots` | 必须读 `shops` 审核通过后才能写 `published_shop_snapshots.is_current = true`；**注意** `packages/db` 中 `shop_video_mentions` / `shop_insights` 与 SQL 不一致 |
| `review-queue-agent` | `review_tasks` 生成、状态流转、审计 | `review_tasks`、`review_events` | 每次人工/AI 操作必须写 `review_events`；人工编辑优先级高于 AI；**注意** `review_events` 字段名 TS 与 SQL 不一致 |
| `recommend-agent` | 规则排序、推荐请求、行为埋点 | `recommendation_requests`、`recommendation_items`、`user_events` | 每次曝光必须带 `request_id`；`feature_snapshot` 必须落库；当前 V0 实现位于 `apps/api/src/routes/public.ts` `/api/shops/recommended` |
| `api-agent` | Fastify API、OpenAPI 契约 | `apps/api/**`、`docs/openapi.yaml` | 不做 AI 业务；不做前端；改 route 必须同步 `docs/openapi.yaml` |
| `web-frontend-agent` | Next.js 用户端 + `/admin` 后台（**单一 app**，不分 `apps/admin`） | `apps/web/**` | 不直连 DB；只调 API；高德 JS API Key 仅通过 `NEXT_PUBLIC_AMAP_WEB_JS_KEY`；fallback mock 数据写在 `apps/web/src/lib/api.ts` 的 `fallbackShops` |
| `scripts-agent` | 一次性运维脚本 | `scripts/migrate.ts`、`scripts/seed-admin.ts` | 不写业务逻辑；脚本必须幂等；migration runner 通过 `schema_migrations` 表追踪已应用文件 |
| `worker-bridge-agent` | `apps/worker` BullMQ 消费者 | `apps/worker/src/index.ts`、`jobs/pipeline.ts`、`adapters/{bilibili,ai,poi}.ts` | AI / POI 通过 HTTP 调 `apps/ai-worker`，不直连模型；必须遵守 `EXTERNAL_MODE` 切换逻辑 |
| `ai-worker-agent` | FastAPI AI/ASR 服务 | `apps/ai-worker/**` | 不直接连 DB；只暴露 HTTP 端点；Pydantic v2 + mypy strict + ruff line-length=100 |
| `test-agent` | 写单元测试 + E2E 测试代码 | `tests/**`（`*.test.ts` / `*.test.py` + `tests/e2e/**`）、`apps/ai-worker/tests/**`、`packages/shared/src/*.test.ts` | TS 单测用 vitest；Python 用 pytest；E2E 用 Playwright。**不**调用浏览器工具（Playwright MCP / `mcp__playwright__*` / headless browser）自己跑 E2E（详见 §2.8） |
| `compliance-agent` | B站协议、隐私、坐标体系、AI 声明 | 合规 checklist、风险 flag 评审 | 是 gate，可以 block 合并 |
| `docs-agent` | 文档、Schema 注释、API 文档 | `docs/**`、代码 docstring | 不写业务逻辑；不擅自改 `docs/MVP-*` 决策性章节；改 API 必须同步 `docs/openapi.yaml` |

未来可扩展：`embedding-agent`（语义检索/推荐向量）、`user-profile-agent`（画像）、`merchant-claim-agent`（商家认领）、`observability-agent`（OpenTelemetry、cost 看板）。

### 1.1 Worker ↔ AI Worker 调用边界

`apps/worker` 通过 HTTP 调用 `apps/ai-worker`：

```
ai-worker:8000
  POST /ai/classify-video         → videoClassificationResultSchema
  POST /ai/extract-shop-candidates (无 schema 强校验，自由 JSON)
  POST /ai/comment-signals        → commentSignalExtractionSchema
  POST /ai/structure-video        → videoStructuredAnalysisSchema
  POST /asr/transcribe            → AsrResponse
  GET  /health
```

M0 阶段 worker 同时跑在 8000 端口的 ai-worker 与 BullMQ 队列上。所有 AI 调用在 `apps/worker/src/jobs/pipeline.ts` 完成 Zod 校验后才落 `ai_runs` + 业务表。

## 2. Agent 通用规则

### 2.1 不变性（Immutability）

- 数据库层：永远 INSERT 新行 + 状态字段流转，不原地 UPDATE AI 输出原始 JSON。`ai_runs.output_payload`、`ai_video_analyses.analysis_json`、`evidence.text_excerpt` 一旦写入只读。
- 代码层：函数返回新对象，不修改入参；状态机推进走"创建新状态事件"而不是"覆盖旧状态"。
- 审核层：人工编辑后保留 `before_json` / `after_json` 到 `review_events`。
- AI 输出文件：mock 数据（`apps/worker/src/adapters/bilibili.ts`、`apps/ai-worker/app/main.py`）升级到真实时保留 fixture 文件作回归基线。

### 2.2 证据链（Evidence）

- 任何对用户可见的结论（卡片文案、推荐菜、避雷点、POI、店铺评价）必须能在 `evidence` 表找到至少一条 `evidence_ids`。
- 字幕 / ASR 为主证据；评论为辅证据；评论不能单独覆盖视频结论。
- 展示时强制显示"AI 总结，仅供参考"+ 证据入口。`apps/web/src/components/shop-card.tsx` 与 `apps/web/src/app/shops/[id]/page.tsx` 已强制显示。

### 2.3 unknown 原则

- AI 输出无证据时必须 `unknown` / `null` / `[]`，并在 `missing_fields` 或 `risk_flags` 显式说明。
- Agent 不得为了让卡片好看而"补全"店名、价格、地址、营业时间、推荐菜。
- 公共页 fallback 数据（`apps/web/src/lib/api.ts` 的 `fallbackShops`）仅用于后端未启动时的演示，**不得作为 AI 真实输出**。

### 2.4 Prompt / Model 版本留痕

每次 AI 调用必须写入 `ai_runs`：

- `stage`（`classify_video` / `extract_shop_candidates` / `comment_signal` / `structure_video` / `match_poi`）
- `provider` / `model` / `prompt_version`（如 `classify_video.v1`、`structure_video.v1`）
- `input_hash`（输入文本 hash）
- `output_payload`（结构化 JSON）
- `usage`（token / 成本）
- `status`（`success` / `failed` / `invalid_json` / `schema_error`）

同一 `(stage, input_hash)` 应可重放；模型升级时 prompt 与 schema 同步升版（`schema_version`）。

### 2.5 坐标与地图

- 高德默认 GCJ-02；写 `pois.geom` 与 `shops.geom` 时必须带 `coord_type` 字段。
- `pois.geom` 和 `shops.geom` 都是 **GENERATED ALWAYS AS STORED**（PostgreSQL 自动从 lng/lat 生成），写入时不要手动设 `geom`。
- 禁止把 WGS-84 / BD-09 直接当作 GCJ-02 写入；如需混用，必须显式转换后落 `wgs84_geom`（**目前 SQL 中尚未实现此字段**）。
- 地图视窗查询统一 `shops.geom && ST_MakeEnvelope(...)`；前端视窗坐标必须与 DB 同坐标系。`apps/api/src/routes/public.ts` 的 `/api/shops/map` 即此实现。

### 2.6 B站凭据

- `bilibili_auth_accounts.encrypted_cookie` 加密存储，绝不写日志、绝不在错误信息或回显中暴露。
- 加密算法：AES-256-GCM，IV + AuthTag + ciphertext 拼 base64。密钥从 `COOKIE_ENCRYPTION_KEY` 经 SHA-256 派生（`apps/api/src/services/crypto.ts`）。
- Agent 在调试 / 测试时只应使用 mock 数据集（`apps/worker/src/adapters/bilibili.ts` 的 fixture），不得在日志、测试夹具、commit 信息、Markdown 文档里出现真实 Cookie。
- 失败任务必须按 `error_code` 分类：登录失效 / 接口变更 / 权限不足 / 限流 / 网络错误。

### 2.7 成本与配额

- Groq：默认 `whisper-large-v3-turbo`；长视频需切片（free tier 25MB / dev tier 100MB）。
- 高德：基础搜索个人 5,000 / 月，企业 50,000 / 月，技术服务许可 500,000 / 月。POI 结果必须缓存 + 原始响应入库 `raw_ingest_payloads`。
- LLM：所有调用按 token 落 `ai_runs.usage`，便于后续成本看板。
- M0 阶段全部 mock，零成本；切到 `EXTERNAL_MODE=real` 时再监控。

### 2.8 测试与 token 资源分配

> **核心规则**：本项目 token 预算优先用于功能实现，测试只保证冒烟与关键回归，禁止过度测试。

- **资源优先级**：实现 > 文档 > 测试。一个新功能落地时，默认不加单测，除非该功能有"重计算 / 重副作用 / 易回退"的边界（如 AI Schema 校验、POI 阈值匹配、发布快照的事务语义）。
- **单测门槛**：仅保留少量关键回归即可：
  - `packages/shared` 的 Zod schema 校验（薄薄一层）
  - `apps/ai-worker` 的 health 与五阶段返回结构 smoke
  - `apps/api` 的 `POST /api/admin/shops/:id/publish` 事务 + 快照版本自增
  - 不要为每个 helper / 每个 enum / 每个 mapping 函数加单测。
- **E2E / 浏览器测试策略**：
  - E2E 测试代码**可以写**（放在 `tests/e2e/**`，用 Playwright），由人或 CI 跑。
  - Agent **不**调用浏览器工具自己验证：禁止用 `mcp__playwright__*` / Playwright MCP / 任何 headless browser / Selenium 工具去打开页面、看 console、截图、点按钮、断言 DOM。这些 token 花得多、还经常 timeout。
  - Agent 跑完 dev 服务后**告诉用户**："请打开 http://localhost:3000 验证 XX 流程"，并把"待验证步骤"列在 commit message / 回复里。
  - 现有 `tests/e2e/smoke.spec.ts` 保留，用户本地或 CI 跑；不强制 agent 自己跑。
  - 任何"页面应该长这样"的需求，Agent 写代码 + 在 commit 描述里画 ASCII 草图 / 描述预期即可，不调用浏览器工具去看。
- **覆盖率**：不强制 80%。`pnpm test` 通过即可，coverage report 只作信息参考。`docs/MVP-bilibili-shop-map.md` §12 的 80% 是产品验收指标，**不是开发期 PR gate**。
- **TDD 例外**：§3.1 步骤 4 的"test-agent 先写 failing test"是规范默认，遇到以下场景必须跳过：
  - 新增纯增删改查的 endpoint（用现有 schema + zod 校验即可，无需单测）
  - 新增 UI 组件（可以写 Playwright E2E 测试在 `tests/e2e/**`，但 agent 不调用浏览器工具自己跑；用手动验证清单列在 commit 描述里）
  - 新增 prompt 模板 / mock fixture（验证靠 MOCK 跑通即可）
  - 修改 SQL migration（验证靠 `pnpm db:migrate` + dev 启动通过）
  - 任何"我得先打开浏览器看看"才能确认的改动 → 写完代码，**告诉用户去浏览器验证**，agent 不调用浏览器工具

### 2.9 探索与中断原则

> **核心规则**：遇到无法独自决定方向、需要探索多个路径的问题，**立即中断执行**，回到对话中与用户确认；不要继续探索、不要写代码、不要写文档、不要提交。

触发中断的典型信号：

- 新需求落在 `docs/` 既有边界之外（例如要做 M2 才规划的能力，或 §15 开放问题里的待确认项）。
- 多个技术选型都能说通但取舍影响后续架构（例如"POI 错配该不该进 recommend"、"是否引入 OpenSearch"、"是否上 TanStack Query"）。
- 涉及 schema / 状态机 / API 契约 / 业务规则的"破坏性变更"（例如改 `risk_flag` 枚举、改发布流程、改 AI 输出 schema_version）。
- 涉及凭据 / 隐私 / 外部 API 配额的策略性选择（例如是否开启评论原文展示、是否缓存 B站登录态）。
- 多个 M 阶段都在等这件事做决定（例如"先实现 M2 还是 M3 还是 M4"）。

中断时的回复必须包含：

1. **当前理解**：一句话重述用户原话。
2. **已知约束**：列出 `CLAUDE.md` / `AGENTS.md` / `docs/` 里相关的硬约束。
3. **候选方向**：用 `Option A / B / C` 列出 2-4 个可行方案，每个方案给：1 句描述 + 1 个推荐依据 + 1 个已知风险。
4. **默认假设**：明确说出"如果你不选，我会按 X 推进"——这样用户沉默也算授权。
5. **回归工作的成本预估**：简单改动 / 中等改动 / 大改，让用户知道一旦决定要花多少 token。

禁止用"先做一半再问你"绕过中断——一旦用户需要打断两次，会显著增加总 token。

### 2.10 前端任务按钮的并发安全 + 可见 loading

任何触发任务（API 调用、enqueue、搜索、审批、晋升、驳回……）的前端按钮，**必须**满足：

1. 任务在跑时，按钮 `disabled`，避免用户重复点击。
2. 任务在跑时，**同一页面的所有其他任务按钮也必须 `disabled`**（用页面级 `busy` 状态而非 per-button）。
3. 当前正在执行的任务按钮要显示 `<LoaderCircle className="animate-spin" />` 替代常态图标，给用户明确反馈。
4. 任务在跑时，页面顶部加一条 "正在执行：<label>（其它操作按钮已禁用）" 的 banner，label 等于 `busy` state 的当前值。

实现模板（`apps/web/src/components/admin-*.tsx` 各页面都按此模式）：

```ts
const [busy, setBusy] = useState<string | null>(null);

async function runAction(label: string, action: () => Promise<void>) {
  setBusy(label);
  try {
    await action();
    await load(); // 重新拉数据
  } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  finally { setBusy(null); }
}

// 按钮：
<button onClick={() => runAction("通过审核", ...)} disabled={!!busy}>
  {busy === "通过审核" ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
  通过审核
</button>
```

子组件接收 `busy: string | null`（不是 `boolean`）以判断自身是否是当前执行方。

后端层面：写操作类端点（approve / publish / promote / reject / select-poi / search-poi）目前无显式并发互斥（依赖前端 `disabled` + worker 单 job 串行）。M1 接 BullMQ 时可以加 advisory lock 双保险。

## 3. 关键工作流

### 3.1 新增功能的标准流程

```
1. docs-agent：先在 docs/ 写或更新"为什么 + 接口契约 + Schema 变更"，再写代码；改 API 同步 docs/openapi.yaml。
2. planner / architect（人）：审 schema 与状态机是否与 docs/MVP-ai-workflow-and-admin-spec.md §3-§13 冲突。
3. schema-agent：写 migration（追加新文件或修改现有文件？需 review）；同步 packages/db/src/schema.ts（**当前 drift，见 §6**）。
4. test-agent：判断要不要写单测 —— **仅**当功能属于 §2.8 列出的"重计算 / 重副作用 / 易回退"边界才写；其余跳过。E2E 测试可以写在 `tests/e2e/**`，但**不**自己调用浏览器工具去跑。
5. 对应领域 agent：写最小实现让代码通过 typecheck + 现有 smoke；如第 4 步写了单测则同时让测试变绿。涉及 UI 时在 commit 描述里附"手动验证清单"（哪些页面 / 哪些交互），**不**调用浏览器工具去看效果。
6. compliance-agent：跑合规 checklist（B站 / 坐标 / AI 声明 / 隐私）。
7. docs-agent：把字段、状态机、API 更新同步进 docs/。
8. 提交 PR；CI 跑 typecheck + lint + 单元 smoke + E2E（如有）；review-queue-agent 监控审核队列是否合理。**用户**手动验证 UI 流程。
```

### 3.2 AI 输出落库流程（`apps/worker/src/jobs/pipeline.ts` 实际编排）

1. JSON parse（失败一次后重试，仍失败记 `ai_output_incomplete`）
2. Schema validate（Zod `videoClassificationResultSchema` / `commentSignalExtractionSchema` / `videoStructuredAnalysisSchema`）
3. Enum validate（`content_type` / `sentiment` / `risk_flag` / `missing_field` 在 `packages/shared/src/enums.ts`）
4. Evidence validate（重要结论必须有 `evidence_ids`）
5. Risk rule evaluate（按 §10.2 幻觉拦截；`packages/shared/src/validation.ts` 的 `findStructuredAnalysisIssues`）
6. Generate `review_tasks`（按 `docs/MVP-database-schema.md` §14.2；`risk_flags.length > 0` 时 `poi_review` priority 80，否则 `shop_candidate_review` priority 50）
7. Save immutable raw output → `ai_runs.output_payload`
8. Save normalized result → `ai_video_analyses` / `shop_candidates` / `poi_match_candidates`

任意一步失败：写 `ai_runs.status` 失败原因 + 创建 `review_tasks` 任务，**不**继续下一步。

### 3.3 POI 匹配规则

| 条件 | 状态 | 是否进审核 | `shop_candidates.status` |
| --- | --- | --- | --- |
| `match_score >= 0.9` 且无风险 | `auto_matched` | 视 `risk_flags` 决定 | `poi_matched` |
| `0.65 <= match_score < 0.9` | `need_review` | 是 | `poi_match_need_review` |
| `match_score < 0.65` | `low_confidence` | 不进前台 | （M0 未显式落 `poi_match_low_confidence`） |
| 无候选 | `no_candidate` | 不进前台 | `extracted`（不动） |
| `shop_name_missing` / `generic_name_risk` / `closed_or_moved_mentioned` | 强制 `need_review` | 是 | `poi_match_need_review` |

`matchPoiJob` 用 `pipelineQueue.add("match_poi", { ... })` 触发；`apps/worker/src/adapters/poi.ts` 返回 `PoiMatchResult`（mock）。

### 3.4 店铺合并 / 拆分

- 强匹配键：`pois.provider + pois.provider_poi_id`。
- 弱匹配：店名相似度 + 坐标距离（< 50m 可疑）+ 地址相似度。
- 合并优先走 `poi-agent` 提出的"疑似同店"任务 → `review-queue-agent` 排队 → 人工在合并页操作。
- 当前实现：`POST /api/admin/shops/merge` 是占位符返回 `{ ok: true, message: "Merge task placeholder created for MVP skeleton" }`，M3 实现。
- 拆分：人工把合并后的 `shops` 拆回多个 `shops` + `shop_video_mentions` 重指；写 `review_events` 记录 `before` / `after`。

### 3.5 前台发布门槛（全部满足才能 `published`）

- `videos.is_shop_visit = true`
- 至少一个 `shop_candidates` 通过审核或 `auto_matched`
- 有有效 POI
- 有可展示卡片标题与推荐理由
- `shops.quality.shop_confidence >= 0.7`
- 无未处理高风险 `risk_flags`
- `published_shop_snapshots.is_current = true` 且 `version` 自增

`apps/api/src/routes/admin.ts` `POST /api/admin/shops/:id/publish` 在事务里：
1. 取 `published_shop_snapshots` 最大 `version`
2. 把当前 shop 全部快照 `is_current` 置 false
3. 写新快照，`version = max + 1`，`is_current = true`，`published_by = admin.id`
4. `UPDATE shops SET status='published', published_at = now()` 并返回

### 3.6 推荐训练数据闭环

从第一天起，每次 `shop_card_impression` 必须写入 `user_events`，并带：

- `recommendation_request_id`（本次请求 ID）
- `recommendation_item_id`（本次曝光的 item ID）
- `surface`（`home` / `map` / `creator_page`）
- `event_payload`（位置、筛选条件、客户端类型）

`recommendation_items.feature_snapshot` 必须保存当时排序特征，禁止后续覆写。V0 规则阶段就该有数据；`POST /api/users/events` 接收 `UserEventRequest`，`recommendation_*_id` 透传到 `user_events`。

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
                                          ↑
                              worker-bridge-agent
                                          ↓
                                  ai-worker-agent
```

- `schema-agent` 必须最先给到表与枚举，否则下游 Agent 无法落库。
- `publish-agent` 必须在 `review-queue-agent` 之后写 `published_shop_snapshots`。
- `recommend-agent` 只读 `shops(status = published)`，不能直读 AI 中间表。
- `worker-bridge-agent` 是 HTTP-only，不直连模型；`ai-worker-agent` 不连 DB。

### 4.2 冲突处理

- 多个 Agent 同时写同一 `entity_id` 时，必须有乐观锁（`updated_at` / `version`）或行级锁；冲突时第二个写入者必须重读 + 重校验。
- 同一 `video_id` 的 AI 阶段有并发风险：必须串行化（用 `jobs` 表的 `status = running` 锁或数据库 advisory lock）。
- 同一 `shop_candidate_id` 的 POI 重排：以最后一次 `ai_runs` 的 `created_at` 为准，前序 `match_status = selected` 改为 `rejected`。
- `apps/api` 与 `apps/worker` 共享同一 DB；同一时刻同一 video 只能有一个 `classify_video` job 在跑。

## 5. 验证与质量门

每个 PR 触发以下 gate；不通过不允许 merge：

1. **Schema gate**：`pnpm typecheck` 通过（捕获 `packages/db` 与 SQL drift）；`schema-agent` 比对 ER 图。
2. **AI JSON gate**：`apps/ai-worker` 健康端点 + 五阶段返回结构 smoke 必须通过（`pnpm test:py`）。
3. **POI gate**：M1 真实高德接入时加少量四态回归（auto_matched / need_review / low_confidence / no_candidate），M0 不强制。
4. **Privacy gate**：禁止在 diff、log、test fixture 中出现明文 Cookie / 手机号 / 邮箱。
5. **Coord gate**：所有 `pois` / `shops` 新增 row 必须有 `coord_type`（DB CHECK 强制）。
6. **UI 验证 gate**（**由用户手动执行**）：首页 / 地图 / 详情 / 后台的"AI 总结，仅供参考"提示 + 证据入口可达，**由用户在 PR 描述或 commit message 的"手动验证清单"里逐项打勾**。Agent 不调用浏览器工具自己验证（详见 §2.8）。
7. **Doc gate**：API 变更 / 状态机变更 / 新增枚举必须同步 `docs/MVP-*.md` + `docs/openapi.yaml`。

> **覆盖率和测试范围**：见 §2.8，本节不重复强制阈值。`pnpm test` 通过 = 单元 smoke 全绿即可合入；E2E（如有）CI 自动跑但不阻塞；浏览器 / 页面 / 交互由用户手动验证。

## 6. 违规与回滚

| 违规行为 | 后果 | 回滚动作 |
| --- | --- | --- |
| 写日志 / 测试夹具中含明文 B站 Cookie | 立即 block + 凭据轮换 | 改密 + 重新登录态入库 + 清理 git history 中的暴露（filter-repo / BFG） |
| AI 输出含 `unknown` 但被强行补全 | 标记 `risk_flags = ai_output_incomplete` + 进入审核 | 删除 `shop_candidates`，重跑 AI |
| `shops.geom` 缺 `coord_type` | DB CHECK 失败，阻止写入 | 全表 backfill + 应用层 strict 校验 |
| 跨层直读（前端直连 DB / 推荐服务直读 AI 中间表） | PR block | 引入 API / 物化视图层 |
| AI Schema 升级未带 `schema_version` 升版 | CI fail | 重跑 migration 记录升级，prompt 与 schema 同步 |
| `packages/db/src/schema.ts` 与 SQL drift 未修复就合入 | schema-agent 阻止 merge | 立刻跑 §6.1 修复流程 |
| 公共页展示未带 "AI 总结，仅供参考" 提示 | review-queue-agent 自动开 `needs_manual_review` | 回滚 PR + 重新打 E2E 用例 |

### 6.1 `packages/db/src/schema.ts` 与 SQL drift 修复流程

`schema-agent` 在每次动到 `db/migrations/` 时必须同步刷新 `packages/db/src/schema.ts`。已知 drift 见 `CLAUDE.md` §数据库表格。修复流程：

1. `git diff packages/db/src/schema.ts db/migrations/` 列差异
2. 优先按 SQL 列名 / 类型对齐 TS（因为 SQL 是 ground truth）
3. 若 TS 设计更合理（如 `review_events.actor_id`），写 migration 改 SQL 并跨 `db/migrations/005_*` 追加，避免回填已部署数据库
4. 同步更新 `docs/MVP-database-schema.md` §3 ER
5. CI 加 grep：禁止 TS 中出现的字段名不在 SQL 中

## 7. 不可做的事（项目红线）

1. **不**绕过 B站反爬、不模拟登录批量拉取、不缓存 / 重分发视频正文与评论原文。
2. **不**把 WGS-84 / BD-09 当 GCJ-02 写入 `geom`。
3. **不**让 AI 自由编造店名 / 地址 / 价格 / 推荐菜 / 营业状态；缺数据就 `unknown`。
4. **不**让评论单独覆盖视频结论。
5. **不**在公共日志或前端展示 `encrypted_cookie`、`session_token_hash`、`password_hash`。
6. **不**在 MVP 阶段做全站博主发现、商家入驻、交易闭环、App 原生端。
7. **不**把"AI 总结，仅供参考"提示去掉，证据入口必须可达。
8. **不**在 PR 中携带迁移导致的对 `ai_runs` / `evidence` 的"原地修改"——任何对历史 AI 输出的修正必须写新 `ai_runs` + `review_events`。
9. **不**让 `apps/web` 直连 DB；只能通过 `apps/api`。
10. **不**让 `apps/ai-worker` 直连 DB；它是纯 HTTP 服务。
11. **不**把 Mock 路径（`apps/worker/src/adapters/bilibili.ts`、`apps/ai-worker/app/main.py` 的 mock 响应）当成生产输出；切 `EXTERNAL_MODE=real` 前 fixture 必须保留作为回归基线。

## 8. 沟通协议

- Agent 在群里 / commit / PR 描述里引用 entity 时必须用 `entity_type:entity_id` 形式（如 `video:01H...`、`shop_candidate:01H...`），避免自然语言歧义。
- Bug / 风险升级：自动开 `review_tasks` + 在 `risk_flags` 添加 `needs_manual_review`，不要直接 ping 真人。
- 决策性改动（Schema 增删字段、状态机变更、推荐算法升级、POI 阈值调整）必须在 `docs/MVP-*.md` 留 PR 链接，不允许"代码 + 文档"分裂。
- 引用代码位置时使用 `file_path:line_number` 格式（点击可跳转）。

---

> 本文件随项目演进；任何新增 Agent 角色、新增红线、新增 gate，必须先在本文件提 PR，由 `docs-agent` + 至少一名领域 Agent 共同 review 后落地。
