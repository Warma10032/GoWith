/**
 * 前端展示用的「英文枚举值 → 中文标签」集中映射。
 *
 * 后端 PostgreSQL 表 / Kysely 返回的字段值是英文枚举（status、workflow_status
 * 等），前端不能直接把原始字符串展示给用户。这里集中维护所有展示层用到的
 * 中文标签，避免散落在各个组件里漂移。
 *
 * 规则：
 * - 每个映射是 readonly 的 record；找不到时调用方得到原始值，再决定是否兜底。
 * - 不在枚举内的字段（视频标题、店名等）不在这里维护，按原文展示。
 * - 后端枚举值变化时，只需修改此文件，不动调用方。
 */

export const CREATOR_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: "活跃",
  paused: "已暂停",
  archived: "已归档",
  pending: "待激活",
};

export const VIDEO_WORKFLOW_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "待同步",
  metadata_synced: "基础信息已同步",
  subtitle_ready: "字幕已就绪",
  asr_ready: "ASR 已转写",
  classified: "已分类",
  non_shop_visit: "非探店视频",
  ai_structured: "AI 结构化完成",
  failed: "处理失败",
};

export const VIDEO_CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  shop_visit: "探店",
  vlog: "日常 vlog",
  guide: "攻略",
  comparison: "横向对比",
  review: "评测",
  non_shop_visit: "非探店",
};

export const SHOP_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "草稿",
  approved: "已通过审核",
  published: "已发布",
  hidden: "已隐藏",
  rejected: "已驳回",
};

export const SHOP_CANDIDATE_STATUS_LABELS: Readonly<Record<string, string>> = {
  extracted: "已抽取",
  poi_matched: "POI 已匹配",
  poi_match_need_review: "POI 待人工审核",
  poi_match_low_confidence: "POI 低置信",
  rejected: "已驳回",
  merged: "已合并",
  promoted: "已晋升",
};

export const RUN_STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: "排队中",
  running: "运行中",
  success: "已完成",
  failed: "失败",
  cancelled: "已取消",
  invalid_json: "JSON 无效",
  schema_error: "校验失败",
};

export const PIPELINE_RUN_TYPE_LABELS: Readonly<Record<string, string>> = {
  creator_video_sync: "同步博主视频",
  creator_profile_sync: "刷新博主资料",
  bilibili_auth_check: "检查 Cookie 池",
  video_processing: "视频处理",
  video_asr_retry: "重新转写视频",
  video_ai_retry: "重新执行 AI 分析",
  poi_match: "POI 匹配",
};

export const AI_RUN_STAGE_LABELS: Readonly<Record<string, string>> = {
  // 老 pipeline stage 名（向后兼容，ai_runs.stage 历史值）
  classify_video: "探店分类",
  extract_shop_candidates: "抽取候选店铺",
  comment_signal: "评论线索",
  structure_video: "结构化总结",
  match_poi: "POI 匹配",
  // 新 ai-worker 把 sub-call 的 prompt key 直接写入 stage 字段
  comment_relevance_filter: "评论相关性筛选",
  comment_analysis: "评论分析",
  transcript_fact_extraction: "转写事实抽取",
  transcript_opinion_analysis: "转写观点分析",
  structure_synthesis: "结构化综合",
  structure_semantic_retry: "结构化语义重试",
  json_repair: "JSON 修复",
};

/**
 * AI 子任务（prompt key）→ 中文标签。
 *
 * 后端在 comment_signal / structure_video 等大阶段下又拆出若干 sub-call
 * prompt，每个 prompt 有独立版本号（key.vN）。详情页的「提示词版本」字段会
 * 把完整 key.vN 字符串直接展示出来，这里维护 key 到中文的映射，并配合
 * {@link formatPromptVersion} 工具函数做 key.vN → 「中文 vN」格式化。
 */
export const AI_PROMPT_LABELS: Readonly<Record<string, string>> = {
  classify_video: "探店分类",
  comment_relevance_filter: "评论相关性筛选",
  comment_analysis: "评论分析",
  transcript_fact_extraction: "转写事实抽取",
  transcript_opinion_analysis: "转写观点分析",
  structure_synthesis: "结构化综合",
  structure_semantic_retry: "结构化语义重试",
  json_repair: "JSON 修复",
  extract_shop_candidates: "抽取候选店铺",
  structure_video: "结构化总结",
  match_poi: "POI 匹配",
};

export const REVIEW_TASK_TYPE_LABELS: Readonly<Record<string, string>> = {
  shop_candidate_review: "候选店铺审核",
  poi_review: "POI 审核",
  ai_validation: "AI 校验",
};

export const BILIBILI_ACCOUNT_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: "可用",
  expired: "已失效",
  paused: "已暂停",
  risk: "风控中",
};

export const POI_MATCH_STATUS_LABELS: Readonly<Record<string, string>> = {
  candidate: "候选",
  selected: "已选用",
  rejected: "已驳回",
};

export const SENTIMENT_LABELS: Readonly<Record<string, string>> = {
  positive: "正面",
  negative: "负面",
  neutral: "中性",
  mixed: "褒贬不一",
};

export const EVIDENCE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  subtitle: "字幕",
  asr: "ASR",
  comment: "评论",
  human: "人工",
};

export const MENTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  primary: "主推",
  secondary: "顺带",
  comparison: "对比",
  main: "主推",
};

export const RISK_FLAG_LABELS: Readonly<Record<string, string>> = {
  low_confidence: "置信度低",
  generic_name: "店名过于通用",
  multi_shop: "多店混淆",
  no_poi_candidate: "无 POI 候选",
  conflicting_name: "店名冲突",
  move_or_closed: "可能搬迁/闭店",
  manual_review_required: "需要人工",
  no_evidence: "证据不足",
};

export const BILIBILI_ERROR_CODE_LABELS: Readonly<Record<string, string>> = {
  login_expired: "登录态过期",
  captcha_required: "需要验证码",
  forbidden: "请求被拒绝",
  rate_limited: "接口限流",
  network_error: "网络错误",
  not_logged_in: "未登录",
  invalid_response: "返回格式异常",
  vip_only: "需要大会员",
  region_locked: "区域受限",
};

export const ENTITY_TYPE_LABELS: Readonly<Record<string, string>> = {
  video: "视频",
  creator: "博主",
  shop: "店铺",
  shop_candidate: "店铺候选",
  poi: "POI",
  ai_run: "AI 运行",
  pipeline_run: "处理任务",
};

/**
 * 坐标系标识：高德/腾讯/谷歌中国 → GCJ-02，国际 GPS → WGS-84，百度 → BD-09。
 * 详情页「坐标」字段后缀展示，让 admin 一眼看清地图数据来源类型。
 */
export const COORD_TYPE_LABELS: Readonly<Record<string, string>> = {
  gcj02: "GCJ-02（高德 / 谷歌中国）",
  wgs84: "WGS-84（GPS）",
  bd09: "BD-09（百度）",
};

/**
 * 在映射表里查中文标签；找不到时返回传入的原始值（开发期便于识别新枚举），
 * 不会把 undefined 渲染到 UI。
 */
export function lookupLabel(
  table: Readonly<Record<string, string>>,
  raw: string | null | undefined,
): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  return table[raw] ?? raw;
}

/**
 * 给一组枚举值批量查中文标签，常用于 risk_flags 这种数组字段。
 * 找不到的保留原值并按原顺序输出，之间用全角逗号分隔。
 */
export function lookupLabels(
  table: Readonly<Record<string, string>>,
  values: ReadonlyArray<string | null | undefined> | null | undefined,
): string {
  if (!values || values.length === 0) return "无";
  const mapped = values
    .map((item) => lookupLabel(table, item))
    .filter((item) => item !== "—");
  return mapped.length > 0 ? mapped.join("，") : "无";
}

/**
 * 把后端返回的 prompt_version 字符串（形如 `comment_analysis.v5`）格式化为
 * 「中文标签 v5」。找不到 key 时回退为原始字符串，避免把脏数据渲染成空白。
 */
export function formatPromptVersion(version: string | null | undefined): string {
  if (!version) return "—";
  // 后端 prompt_version 形如 `comment_analysis.v5`，版本段已带 `v` 前缀。
  // 因此只补一个空格分隔，不重复 `v`。
  const [key = "", ...rest] = version.split(".");
  const label = AI_PROMPT_LABELS[key] ?? key;
  const versionTail = rest.length > 0 ? ` ${rest.join(".")}` : "";
  return `${label}${versionTail}`;
}
