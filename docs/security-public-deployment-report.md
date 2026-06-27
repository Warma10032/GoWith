# GoWith 公网部署安全漏洞报告

生成日期：2026-06-27  
审计范围：`apps/api`、`apps/web`、`apps/worker`、`apps/ai-worker`、`docker-compose.yml`、`.env.example`、`docs/openapi.yaml` 与核心项目文档。  
审计方式：尝试启动 Codex Security Deep Security Scan 时，插件工作区在 Windows 读取 Git 元数据时触发 `gbk` 解码异常，未能完成正式 Deep Scan。本报告基于只读静态审计、项目文档约束与公网部署威胁建模整理。

## 1. 总体结论

当前仓库仍更接近本地 / 内网开发部署形态，不建议直接把现有 Docker Compose 与服务端口暴露到公网。

上线前必须优先处理：

- 生产环境密钥强校验，禁止 fallback 到 dev 默认值。
- 后台登录限速、失败锁定、CSRF 防护与管理员会话收紧。
- AI Worker、PostgreSQL、Redis、Worker 仅内网可达，公网只暴露 Web 与经反代保护的 API。
- 图片下载链路增加 SSRF 防护、文件类型校验，并禁止同源托管 SVG。
- 生产环境错误响应脱敏，关闭或保护 Swagger UI。

## 2. P0 必修漏洞

### 2.1 生产环境允许使用开发默认密钥

证据：

- `apps/api/src/lib/env.ts` 中 `AUTH_SECRET` fallback 到 `dev-only-auth-secret-change-me`。
- `apps/api/src/lib/env.ts` 与 `apps/worker/src/env.ts` 中 `COOKIE_ENCRYPTION_KEY` fallback 到 `dev-only-cookie-key-change-me`。

影响：

- 如果生产环境漏配密钥，session token hash 与 B站 Cookie 加密都依赖公开默认值。
- 一旦数据库泄露，攻击者更容易离线分析 session hash 或解密服务端保存的 B站 Cookie。

修复方法：

- 在 `NODE_ENV=production` 下强制校验 `AUTH_SECRET`、`COOKIE_ENCRYPTION_KEY`、`DATABASE_URL`、`REDIS_URL`。
- 缺失、长度不足、等于 dev 默认值时直接启动失败。
- 要求密钥来自 KMS / Secret Manager / Docker secret，不写入镜像和仓库。
- `COOKIE_ENCRYPTION_KEY` 建议使用 32 bytes 以上随机值，并为后续 key rotation 预留 `key_id`。

### 2.2 后台登录无速率限制和失败锁定

证据：

- `apps/api/src/routes/auth.ts` 的 `POST /api/auth/login` 直接调用密码登录逻辑。
- `apps/api/src/services/auth.ts` 中只做 bcrypt 校验，未记录失败次数、IP、UA，也没有退避。

影响：

- 公网登录口可被撞库和暴力破解。
- 管理后台目前是系统最高权限入口，一旦管理员账号被爆破，可写入 B站 Cookie、触发任务、发布或删除店铺数据。

修复方法：

- 引入 `@fastify/rate-limit`，按 IP、email、IP+email 三维限速。
- 登录失败写入审计表或 Redis，达到阈值后短期锁定账号或要求人工解锁。
- 管理员启用 2FA、一次性恢复码或至少部署层 Basic Auth / VPN。
- 对 `ADMIN_INITIAL_PASSWORD` 做生产强度校验，首次登录后强制修改。

### 2.3 管理写接口缺少 CSRF 防护

证据：

- `apps/api/src/services/auth.ts` 设置 `gowith_session` 为 `httpOnly`、`sameSite: "lax"`。
- `apps/api/src/routes/admin.ts` 通过 `preHandler` 对 `/api/admin/**` 做 cookie session 鉴权，但写操作未要求 CSRF token。

影响：

- 当前 `SameSite=Lax` 能缓解一部分跨站请求，但无法作为完整 CSRF 策略。
- 如果未来为跨域部署改成 `SameSite=None`，或后台/API 子域策略配置错误，后台写接口可能被跨站触发。

修复方法：

- 登录时下发 CSRF token，前端所有 `/api/admin/**` 非 GET 请求带 `X-CSRF-Token`。
- 服务端使用双提交 cookie 或 session 绑定 token 校验。
- 同时校验 `Origin` / `Referer` 必须等于后台域名。
- 对发布、删除、写入 B站 Cookie、重跑任务等高风险动作增加二次确认或短期 action nonce。

### 2.4 AI Worker 无鉴权且 Docker Compose 暴露公网端口

证据：

- `apps/ai-worker/app/main.py` 暴露 `/asr/transcribe`、`/ai/classify-video`、`/ai/comment-signals`、`/ai/structure-video` 等端点。
- `docker-compose.yml` 将 `18000:18000` 映射到宿主机。
- Worker 调 AI Worker 时未带内部认证头。

影响：

- 如果 `18000` 暴露公网，攻击者可直接调用 ASR / LLM，消耗 Groq、MiniMax 等第三方额度。
- 可用大文件或大量请求造成 CPU、磁盘、内存、第三方 API 成本 DoS。
- 直接绕过 Worker 的 Zod 校验、AI runs 留痕和任务状态机。

修复方法：

- 生产环境删除 `ai-worker` 的公网 `ports` 映射，仅在 Docker 网络内暴露。
- AI Worker 增加内部 shared secret、mTLS 或 service mesh 身份校验。
- Worker 调用 AI Worker 时带 `Authorization: Bearer <internal token>`。
- 反代层明确只转发 Web/API，不转发 AI Worker。
- 对 ASR 上传设置 body size、并发数和任务队列上限。

### 2.5 PostgreSQL / Redis 使用默认弱口令并映射宿主端口

证据：

- `docker-compose.yml` 中 PostgreSQL 使用 `gowith/gowith`。
- Redis 未配置密码。
- PostgreSQL `15432:5432`、Redis `16379:6379` 映射到宿主机。

影响：

- 云主机安全组或防火墙误开时，数据库和队列可被外部直接访问。
- Redis 被访问后可污染队列、触发任务或造成数据破坏。
- 数据库泄露会暴露用户、B站加密 Cookie、AI 输入输出、评论样本和发布数据。

修复方法：

- 生产环境不映射 DB / Redis 到公网接口。
- PostgreSQL 使用强随机密码，并按 API、Worker、迁移脚本分配最小权限账号。
- Redis 开启 ACL / password，只允许内网访问。
- 云安全组只允许应用内网访问 DB / Redis。
- 定期备份加密，备份访问权限与运行库隔离。

### 2.6 图片下载存在 SSRF 与同源 SVG XSS 风险

证据：

- `apps/worker/src/services/image-downloader.ts` 只判断 URL 是否为 `http/https`。
- 下载时 `redirect: "follow"`，未限制最终 IP、域名、协议和重定向链。
- 允许 `image/svg+xml`，并由 `apps/api/src/lib/app.ts` 通过 `/uploads/` 同源静态服务。

影响：

- 如果第三方图片 URL 被污染，Worker 可请求内网地址、云 metadata 地址或本机服务，形成 SSRF。
- SVG 作为同源资源被访问时可能执行脚本或利用浏览器 SVG 行为窃取上下文。
- 大量恶意图片 URL 可造成磁盘和网络资源消耗。

修复方法：

- 下载前解析 URL，并在 DNS 解析后拒绝内网、环回、链路本地、metadata IP。
- 每次重定向后重新校验目标地址。
- 对 B站、高德等图片来源做域名白名单，至少先以 allowlist 启动。
- 移除 SVG 支持，只允许 JPEG、PNG、WebP、AVIF 等安全位图。
- 校验文件 magic，不只信任 `Content-Type`。
- 上传静态资源使用独立无 Cookie 域名，或对 SVG 强制 `Content-Disposition: attachment`。

## 3. P1 高优先级漏洞

### 3.1 生产错误响应泄露内部信息

证据：

- `apps/api/src/lib/http.ts` 对未知错误返回原始 `error.message`。
- `apps/ai-worker/app/main.py` 的 ffmpeg 和第三方 API 错误可能把部分 stderr / response text 放入 HTTP 响应。

影响：

- 攻击者可通过构造异常探测文件路径、第三方 API 响应、内部服务状态和技术栈细节。
- 如果上游错误包含敏感参数，可能被回显到客户端。

修复方法：

- 生产环境统一返回通用错误码，如 `internal_error`。
- 详细错误只写入结构化日志，并做敏感字段脱敏。
- 第三方响应内容不要直接回显，最多返回稳定错误分类。

### 3.2 Swagger UI 公网暴露

证据：

- `apps/api/src/lib/app.ts` 注册 `@fastify/swagger-ui`，路径为 `/docs`。

影响：

- 攻击者可完整枚举后台接口、请求体、状态机和数据结构。
- 配合登录爆破或 CSRF 可降低攻击成本。

修复方法：

- 生产环境默认禁用 `/docs`。
- 如确需保留，放在 VPN / Basic Auth / 内网后面。
- 对外发布脱敏版 OpenAPI，隐藏管理端敏感字段和内部任务接口。

### 3.3 SSE 手动回显任意 Origin

证据：

- `apps/api/src/routes/admin.ts` 的 `/api/admin/task-stream` 在响应头中手动设置 `Access-Control-Allow-Origin` 为 `request.headers.origin`。

影响：

- 当前端点先执行 `requireAdmin`，直接泄露风险有限。
- 但该实现绕过统一 CORS 白名单，后续改动或反代错误可能导致跨站读取管理任务流。

修复方法：

- 删除手写 CORS 响应头，复用 Fastify CORS 白名单。
- 非白名单 Origin 直接拒绝。
- SSE 也使用同一套 `Origin` 校验和 CSRF / session 策略。

### 3.4 用户事件埋点接口无认证、无限速、payload 无大小上限

证据：

- `apps/api/src/routes/public.ts` 的 `POST /api/users/events` 允许匿名写入。
- `packages/shared/src/api.ts` 中 `event_payload` 是开放 record，缺少大小、深度和枚举限制。

影响：

- 攻击者可刷入大量事件，撑爆数据库。
- 推荐训练数据可被污染，影响后续排序模型。
- 超大 JSON payload 可能造成 API 和 DB 压力。

修复方法：

- 增加 IP / anonymous_id / session 维度限速。
- 限制 `event_name`、`surface`、`entity_type` 为枚举。
- 限制 payload 大小、字段数量、嵌套深度。
- 对异常事件流做丢弃或隔离，不进入训练样本。

### 3.5 ASR 上传先完整读入内存和磁盘

证据：

- `apps/ai-worker/app/main.py` 中 `source.write_bytes(await file.read())` 会完整读取上传文件。
- 后续调用 ffmpeg 处理音频，缺少请求体大小和并发控制。

影响：

- 大文件或并发上传可造成内存、磁盘、CPU DoS。
- 如果 AI Worker 暴露公网，还会直接消耗 Groq ASR 成本。

修复方法：

- 反代层设置 `client_max_body_size` / request body limit。
- FastAPI 流式读取并提前截断超限文件。
- ASR endpoint 仅内网可达。
- 任务队列限制并发，单视频 ASR 设置最大时长和最大分片数。

### 3.6 公共搜索和地图参数未完整 Schema 化

证据：

- `/api/shops/map` 直接 `Number(query.min_lng ?? 70)` 等解析 bbox。
- `/api/shops/search` 直接使用 `q?.trim()`，缺少长度和字符约束。

影响：

- `NaN`、超长搜索词、大范围 bbox 可能导致 500、慢查询或数据库压力。
- 攻击者可用低成本请求触发 PostGIS / trigram 查询消耗。

修复方法：

- 使用 Zod 为 map/search 建立 query schema。
- 限制 bbox 合法范围和最大面积。
- 限制搜索词长度，例如 1-80 字符。
- 增加慢查询超时、结果缓存和 per-IP 限速。

## 4. P2 中优先级漏洞与加固项

### 4.1 Session 过长且缺少设备指纹

证据：

- `apps/api/src/services/auth.ts` 中 session 有效期为 30 天。
- 登录时 `ip_hash`、`user_agent` 写入为 `null`。

影响：

- 后台 Cookie 被盗后可用窗口较长。
- 无法按设备识别异常登录或精确吊销。

修复方法：

- 后台 session 缩短到 8-24 小时，支持滑动续期。
- 记录 `user_agent_hash`、`ip_prefix_hash` 和最近活跃时间。
- 敏感操作要求短期 re-auth。

### 4.2 Cookie 加密缺少 key rotation

证据：

- `apps/api/src/services/crypto.ts` 直接从单一 `COOKIE_ENCRYPTION_KEY` 派生 AES-GCM key。
- 密文中未保存 `key_id`。

影响：

- 一旦密钥泄露，历史 B站 Cookie 全部可解密。
- 换密钥需要一次性重加密或导致旧数据不可读。

修复方法：

- 密文格式增加 `key_id`。
- 支持多密钥解密、新密钥加密。
- 提供幂等重加密脚本。
- 密钥存放到 KMS / Secret Manager，并限制可读取服务。

### 4.3 Docker 生产配置仍使用 dev server、热重载和源码挂载

证据：

- `docker-compose.yml` 中 API / Worker / Web 会执行 `pnpm install` 和 dev 命令。
- AI Worker 使用 `uvicorn --reload`。
- 多个服务挂载整个仓库目录到容器。

影响：

- 攻击面和资源消耗大，启动不稳定。
- 源码和 `.env` 直接挂进运行容器，容器逃逸或任意文件读风险更高。

修复方法：

- 生产使用多阶段构建镜像，只复制构建产物和必要依赖。
- 容器使用非 root 用户、只读 filesystem、最小 capabilities。
- 去掉源码 volume、`--reload`、dev server。
- API / Worker / AI Worker 分别构建最小镜像。

### 4.4 外部 API key 可能进入 URL 日志

证据：

- `apps/worker/src/adapters/poi.ts` 将高德 `key` 放在 query string 中。

影响：

- 反代日志、异常追踪、第三方抓包或调试日志可能记录完整 URL，泄露高德 key。

修复方法：

- 日志中统一脱敏 query 参数 `key`、`token`、`secret`。
- 如果第三方 API 支持，优先使用 header 传 key。
- 第三方 key 按环境拆分，限制来源、配额和权限。

### 4.5 安全响应头缺失

证据：

- API 未配置 `@fastify/helmet`。
- Web 未显式配置 CSP、HSTS、frame-ancestors 等安全头。

影响：

- XSS、点击劫持、降级访问、MIME sniffing 等浏览器侧风险缺少统一防线。

修复方法：

- API 使用 `@fastify/helmet`。
- Web / 反代配置：
  - `Strict-Transport-Security`
  - `Content-Security-Policy`
  - `X-Frame-Options` 或 `frame-ancestors`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy`
  - `Permissions-Policy`

## 5. 部署红线

- 不要把当前 `docker-compose.yml` 原样用于公网。
- 公网只应暴露 Web 和经 HTTPS 反代保护的 API。
- PostgreSQL、Redis、Worker、AI Worker 必须仅内网可达。
- 管理后台建议放在独立子域，至少加 VPN / IP allowlist / Basic Auth 中的一层。
- B站 Cookie、第三方 API key、数据库密码不得进入日志、前端 bundle、PR 描述或测试 fixture。
- `/uploads` 建议使用独立无 Cookie 静态域名，降低同源资源风险。

## 6. 推荐修复顺序

1. 修复 P0：生产密钥强校验、内网隔离、登录限速、CSRF、图片下载 SSRF/SVG 防护。
2. 修复 P1：错误脱敏、关闭 Swagger、埋点限流、ASR 上传限额、公共查询 schema。
3. 完成 P2：session 收紧、key rotation、生产镜像、安全响应头、外部 API key 日志脱敏。
4. 补充自动化 gate：生产配置检查、secret 扫描、Docker 暴露端口检查、依赖漏洞扫描。

## 7. 建议新增安全验收清单

- [ ] `NODE_ENV=production` 下缺少强密钥会启动失败。
- [ ] `/api/auth/login` 有 IP + email 限速和失败锁定。
- [ ] 所有 `/api/admin/**` 写接口校验 CSRF token 与 Origin。
- [ ] 生产 compose / k8s manifest 不暴露 DB、Redis、Worker、AI Worker。
- [ ] AI Worker 仅允许 Worker 内部认证调用。
- [ ] 图片下载拒绝内网 IP、metadata IP、非白名单域名和 SVG。
- [ ] `/docs` 在生产环境关闭或加访问控制。
- [ ] 生产错误响应不包含内部异常 message。
- [ ] `/api/users/events` 有限速、payload 大小限制和事件枚举。
- [ ] 反代配置 HTTPS、HSTS、CSP、上传体积限制和日志脱敏。
