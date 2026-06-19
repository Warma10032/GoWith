import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type Json = ColumnType<JsonValue, unknown, unknown>;

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
export type GeneratedUuid = Generated<string>;

export interface UsersTable {
  id: GeneratedUuid;
  email: string | null;
  phone: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  avatar_source_url: string | null;
  role: "user" | "admin";
  status: "active" | "disabled";
  password_hash: string | null;
  last_login_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuthSessionsTable {
  id: GeneratedUuid;
  user_id: string;
  session_token_hash: string;
  client_type: "web" | "miniapp" | "app";
  ip_hash: string | null;
  user_agent: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
}

export interface BilibiliAuthAccountsTable {
  id: GeneratedUuid;
  label: string;
  encrypted_cookie: string;
  csrf_token_encrypted: string | null;
  status: "active" | "expired" | "paused" | "risk";
  last_health_check_at: Timestamp | null;
  last_success_at: Timestamp | null;
  last_error_code: string | null;
  last_error_message: string | null;
  rate_limit_policy: Json;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RawIngestPayloadsTable {
  id: GeneratedUuid;
  provider: string;
  resource_type: string;
  resource_key: string;
  request_hash: string;
  payload: Json | null;
  object_key: string | null;
  payload_sha256: string;
  fetched_at: Timestamp;
  expires_at: Timestamp | null;
  created_at: Timestamp;
}

export interface CreatorsTable {
  id: GeneratedUuid;
  bilibili_uid: string;
  name: string;
  avatar_url: string | null;
  avatar_source_url: string | null;
  profile_url: string;
  bio: string | null;
  follower_count: number | null;
  status: "active" | "paused" | "error";
  sync_mode: "full" | "incremental";
  last_synced_at: Timestamp | null;
  last_video_published_at: Timestamp | null;
  stats: Json;
  raw_payload_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface VideosTable {
  id: GeneratedUuid;
  creator_id: string;
  bvid: string;
  aid: string | null;
  cid: string | null;
  title: string;
  description: string | null;
  cover_url: string | null;
  cover_source_url: string | null;
  source_url: string;
  duration_sec: number | null;
  published_at: Timestamp | null;
  tags: string[];
  category: string | null;
  stats: Json;
  workflow_status: string;
  is_shop_visit: boolean | null;
  content_type: string | null;
  classification_confidence: number | null;
  risk_flags: string[];
  raw_payload_id: string | null;
  last_synced_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface JobsTable {
  id: GeneratedUuid;
  job_type: string;
  entity_type: string;
  entity_id: string;
  run_id: string | null;
  payload: Json;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  priority: number;
  attempts: number;
  max_attempts: number;
  scheduled_at: Timestamp;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PipelineRunsTable {
  id: GeneratedUuid;
  run_type: "creator_video_sync" | "video_processing" | "video_asr_retry" | "video_ai_retry" | "poi_match";
  entity_type: string;
  entity_id: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  triggered_by: string | null;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  summary_json: Json;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PipelineEventsTable {
  id: GeneratedUuid;
  run_id: string;
  job_id: string | null;
  entity_type: string;
  entity_id: string;
  stage: string;
  event_type: "queued" | "started" | "progress" | "ai_request_prepared" | "ai_response_validated" | "saved" | "skipped" | "failed" | "completed";
  level: "info" | "success" | "warning" | "error";
  title: string;
  message: string | null;
  progress_percent: number | null;
  detail_json: Json;
  ai_run_id: string | null;
  created_at: Timestamp;
}

export interface VideoTextAssetsTable {
  id: GeneratedUuid;
  video_id: string;
  source: "subtitle" | "asr";
  language: string | null;
  content_text: string;
  content_sha256: string;
  segments: Json;
  model_provider: string | null;
  model_name: string | null;
  status: "ready" | "failed";
  error_message: string | null;
  object_key: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface VideoTextSegmentsTable {
  id: GeneratedUuid;
  asset_id: string;
  video_id: string;
  segment_index: number;
  start_sec: number | null;
  end_sec: number | null;
  text: string;
  confidence: number | null;
  created_at: Timestamp;
}

export interface VideoCommentsTable {
  id: GeneratedUuid;
  video_id: string;
  platform_comment_id: string;
  parent_comment_id: string | null;
  content: string;
  content_sha256: string;
  user_hash: string | null;
  like_count: number | null;
  reply_count: number | null;
  published_at: Timestamp | null;
  sample_type: "hot" | "latest" | "keyword";
  contains_location_signal: boolean;
  contains_shop_signal: boolean;
  raw_payload_id: string | null;
  created_at: Timestamp;
}

export interface AiRunsTable {
  id: GeneratedUuid;
  stage: string;
  entity_type: string;
  entity_id: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  input_payload: Json;
  output_payload: Json | null;
  raw_output_text: string | null;
  usage: Json;
  status: "success" | "failed" | "invalid_json" | "schema_error";
  error_message: string | null;
  started_at: Timestamp;
  finished_at: Timestamp | null;
  created_at: Timestamp;
}

export interface VideoClassificationsTable {
  id: GeneratedUuid;
  video_id: string;
  ai_run_id: string;
  is_shop_visit: boolean;
  content_type: string;
  confidence: number;
  reason_codes: string[];
  risk_flags: string[];
  need_manual_review: boolean;
  evidence_ids: string[];
  created_at: Timestamp;
}

export interface CommentSignalExtractionsTable {
  id: GeneratedUuid;
  video_id: string;
  ai_run_id: string;
  sample_strategy: Json;
  shop_name_mentions: Json;
  address_mentions: Json;
  status_mentions: Json;
  aspect_sentiments: Json;
  risk_flags: string[];
  created_at: Timestamp;
}

export interface AiVideoAnalysesTable {
  id: GeneratedUuid;
  video_id: string;
  ai_run_id: string;
  schema_version: string;
  analysis_json: Json;
  overall_summary: string | null;
  analysis_confidence: number | null;
  shop_candidate_count: number;
  risk_flags: string[];
  validation_status: "valid" | "invalid" | "needs_review";
  validation_errors: Json;
  created_at: Timestamp;
}

export interface ShopCandidatesTable {
  id: GeneratedUuid;
  video_id: string;
  creator_id: string;
  ai_video_analysis_id: string | null;
  candidate_name: string | null;
  normalized_name: string | null;
  alias_names: string[];
  candidate_type: "physical_shop" | "unknown" | "not_shop";
  category_primary: string | null;
  category_secondary: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  business_area: string | null;
  address_hint: string | null;
  landmarks: string[];
  time_start_sec: number | null;
  time_end_sec: number | null;
  name_confidence: number | null;
  location_confidence: number | null;
  summary_confidence: number | null;
  card_payload: Json;
  review_dimensions: Json;
  comment_summary: Json;
  missing_fields: string[];
  risk_flags: string[];
  status: string;
  selected_poi_id: string | null;
  merged_shop_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface EvidenceTable {
  id: GeneratedUuid;
  video_id: string | null;
  shop_candidate_id: string | null;
  shop_id: string | null;
  source: string;
  source_ref_id: string | null;
  text_excerpt: string;
  start_sec: number | null;
  end_sec: number | null;
  confidence: number | null;
  metadata: Json;
  created_at: Timestamp;
}

export interface PoisTable {
  id: GeneratedUuid;
  provider: "amap" | "tencent" | "baidu";
  provider_poi_id: string;
  name: string;
  address: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  business_area: string | null;
  category: string | null;
  category_code: string | null;
  lng: number;
  lat: number;
  coord_type: "gcj02" | "bd09" | "wgs84";
  phone: string | null;
  business_hours: string | null;
  raw_payload_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PoiMatchAttemptsTable {
  id: GeneratedUuid;
  shop_candidate_id: string;
  provider: string;
  query_strategy: string;
  query_payload: Json;
  status: "success" | "failed" | "no_candidate";
  raw_payload_id: string | null;
  error_message: string | null;
  created_at: Timestamp;
}

export interface PoiMatchCandidatesTable {
  id: GeneratedUuid;
  attempt_id: string;
  shop_candidate_id: string;
  poi_id: string;
  rank: number;
  match_features: Json;
  match_score: number;
  match_status: "candidate" | "selected" | "rejected";
  created_at: Timestamp;
}

export interface ShopsTable {
  id: GeneratedUuid;
  primary_poi_id: string;
  canonical_name: string;
  display_name: string;
  category_primary: string | null;
  category_secondary: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  business_area: string | null;
  address: string | null;
  lng: number;
  lat: number;
  coord_type: "gcj02" | "bd09" | "wgs84";
  avg_price_hint: string | null;
  card_payload: Json;
  aggregated_review: Json;
  quality: Json;
  source_stats: Json;
  status: string;
  published_at: Timestamp | null;
  last_reviewed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ShopAliasesTable {
  id: GeneratedUuid;
  shop_id: string;
  alias_name: string;
  source: string;
  confidence: number | null;
  created_at: Timestamp;
}

export interface ShopVideoMentionsTable {
  id: GeneratedUuid;
  shop_id: string;
  video_id: string;
  creator_id: string;
  shop_candidate_id: string | null;
  mention_type: string;
  sentiment: string;
  evidence_ids: string[];
  confidence: ColumnType<number, number | undefined, number>;
  time_start_sec: number | null;
  time_end_sec: number | null;
  summary: string | null;
  created_at: Timestamp;
}

export interface ShopInsightsTable {
  id: GeneratedUuid;
  shop_id: string;
  insight_type: string;
  payload: Json;
  source_video_ids: string[];
  source_comment_ids: string[];
  confidence: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PublishedShopSnapshotsTable {
  id: GeneratedUuid;
  shop_id: string;
  version: number;
  snapshot_json: Json;
  published_by: string | null;
  published_at: Timestamp;
  is_current: boolean;
}

export interface ReviewTasksTable {
  id: GeneratedUuid;
  task_type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  reason: string;
  priority: number;
  status: string;
  risk_flags: string[];
  payload: Json;
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ReviewEventsTable {
  id: GeneratedUuid;
  review_task_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  before_json: Json | null;
  after_json: Json | null;
  reason: string | null;
  reviewer_id: string;
  created_at: Timestamp;
}

export interface CreatorFollowsTable {
  id: GeneratedUuid;
  user_id: string;
  creator_id: string;
  created_at: Timestamp;
}

export interface UserFavoritesTable {
  id: GeneratedUuid;
  user_id: string;
  shop_id: string;
  action_type: "favorite" | "want_to_go" | "visited";
  note: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RecommendationRequestsTable {
  id: GeneratedUuid;
  user_id: string | null;
  anonymous_id: string | null;
  surface: string;
  request_context: Json;
  algorithm: string;
  model_version: string | null;
  created_at: Timestamp;
}

export interface RecommendationItemsTable {
  id: GeneratedUuid;
  request_id: string;
  shop_id: string;
  rank: number;
  score: number;
  reason_codes: string[];
  feature_snapshot: Json;
  created_at: Timestamp;
}

export interface UserEventsTable {
  id: GeneratedUuid;
  user_id: string | null;
  anonymous_id: string | null;
  event_name: string;
  entity_type: string | null;
  entity_id: string | null;
  shop_id: string | null;
  creator_id: string | null;
  video_id: string | null;
  recommendation_request_id: string | null;
  recommendation_item_id: string | null;
  surface: string;
  event_payload: Json;
  client_type: "web" | "miniapp" | "app";
  created_at: Timestamp;
}

export interface DB {
  users: UsersTable;
  auth_sessions: AuthSessionsTable;
  bilibili_auth_accounts: BilibiliAuthAccountsTable;
  raw_ingest_payloads: RawIngestPayloadsTable;
  creators: CreatorsTable;
  videos: VideosTable;
  jobs: JobsTable;
  pipeline_runs: PipelineRunsTable;
  pipeline_events: PipelineEventsTable;
  video_text_assets: VideoTextAssetsTable;
  video_text_segments: VideoTextSegmentsTable;
  video_comments: VideoCommentsTable;
  ai_runs: AiRunsTable;
  video_classifications: VideoClassificationsTable;
  comment_signal_extractions: CommentSignalExtractionsTable;
  ai_video_analyses: AiVideoAnalysesTable;
  shop_candidates: ShopCandidatesTable;
  evidence: EvidenceTable;
  pois: PoisTable;
  poi_match_attempts: PoiMatchAttemptsTable;
  poi_match_candidates: PoiMatchCandidatesTable;
  shops: ShopsTable;
  shop_aliases: ShopAliasesTable;
  shop_video_mentions: ShopVideoMentionsTable;
  shop_insights: ShopInsightsTable;
  published_shop_snapshots: PublishedShopSnapshotsTable;
  review_tasks: ReviewTasksTable;
  review_events: ReviewEventsTable;
  creator_follows: CreatorFollowsTable;
  user_favorites: UserFavoritesTable;
  recommendation_requests: RecommendationRequestsTable;
  recommendation_items: RecommendationItemsTable;
  user_events: UserEventsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Creator = Selectable<CreatorsTable>;
export type Video = Selectable<VideosTable>;
export type Shop = Selectable<ShopsTable>;
export type ShopCandidate = Selectable<ShopCandidatesTable>;
export type ReviewTask = Selectable<ReviewTasksTable>;
