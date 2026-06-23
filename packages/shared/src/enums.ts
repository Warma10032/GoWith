export const contentTypes = [
  "single_shop_visit",
  "multi_shop_visit",
  "city_food_collection",
  "travel_vlog_with_shops",
  "food_review_not_shop",
  "not_physical_shop",
  "non_shop_visit",
  "unknown",
] as const;

export const sentiments = [
  "positive",
  "neutral",
  "negative",
  "mixed",
  "controversial",
  "unknown",
] as const;

export const evidenceSources = [
  "title",
  "description",
  "tag",
  "subtitle",
  "asr",
  "comment",
  "danmaku",
  "manual_review",
  "poi_provider",
  "system_inference",
] as const;

export const riskFlags = [
  "non_shop_visit_possible",
  "shop_name_missing",
  "shop_name_ambiguous",
  "generic_name_risk",
  "multiple_shops_in_video",
  "address_missing",
  "city_missing",
  "poi_no_candidate",
  "poi_low_confidence",
  "poi_many_same_name_candidates",
  "chain_store_branch_uncertain",
  "closed_or_moved_mentioned",
  "comment_conflict",
  "asr_low_quality",
  "subtitle_missing",
  "insufficient_evidence",
  "ai_output_incomplete",
  "needs_manual_review",
] as const;

export const missingFields = [
  "shop_name",
  "city",
  "district",
  "business_area",
  "exact_address",
  "poi",
  "opening_hours",
  "phone",
  "recommended_dishes",
  "avoid_points",
  "service",
  "environment",
  "queue",
  "parking",
  "reservation",
] as const;

export const videoWorkflowStatuses = [
  "new",
  "metadata_synced",
  "subtitle_ready",
  "asr_ready",
  "text_unavailable",
  "classified",
  "non_shop_visit",
  "shop_candidates_extracted",
  "ai_structured",
  "poi_matching",
  "need_review",
  "approved",
  "published",
  "rejected",
  "failed",
] as const;

export const shopCandidateStatuses = [
  "extracted",
  "name_missing",
  "poi_candidates_found",
  "poi_match_low_confidence",
  "poi_match_need_review",
  "poi_matched",
  "merged",
  "approved",
  "published",
  "rejected",
] as const;

export const reviewTaskStatuses = [
  "open",
  "in_progress",
  "resolved",
  "rejected",
  "cancelled",
] as const;

export const shopStatuses = [
  "draft",
  "published",
  "hidden",
  "needs_recheck",
  "rejected",
  "merged",
] as const;

export const poiMatchStatuses = [
  "not_started",
  "no_candidate",
  "low_confidence",
  "need_review",
  "auto_matched",
  "manual_matched",
  "manual_rejected",
] as const;

export type ContentType = (typeof contentTypes)[number];
export type Sentiment = (typeof sentiments)[number];
export type EvidenceSource = (typeof evidenceSources)[number];
export type RiskFlag = (typeof riskFlags)[number];
export type MissingField = (typeof missingFields)[number];
export type VideoWorkflowStatus = (typeof videoWorkflowStatuses)[number];
export type ShopCandidateStatus = (typeof shopCandidateStatuses)[number];
export type ReviewTaskStatus = (typeof reviewTaskStatuses)[number];
export type ShopStatus = (typeof shopStatuses)[number];
export type PoiMatchStatus = (typeof poiMatchStatuses)[number];
