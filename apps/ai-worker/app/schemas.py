from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


Confidence = Annotated[float, Field(ge=0, le=1)]
ContentType = Literal[
    "single_shop_visit",
    "multi_shop_visit",
    "city_food_collection",
    "travel_vlog_with_shops",
    "food_review_not_shop",
    "not_physical_shop",
    "non_shop_visit",
    "unknown",
]
RiskFlag = Literal[
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
]
MissingField = Literal[
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
]
Sentiment = Literal["positive", "neutral", "negative", "mixed", "controversial", "unknown"]


class TranscriptSegment(StrictModel):
    segment_id: str | None = None
    start_sec: float
    end_sec: float
    text: str
    confidence: float | None = None


class VideoMetadata(StrictModel):
    video_id: str
    bvid: str
    creator_id: str
    title: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    category: str | None = None
    evidence: list["MetadataEvidence"] = Field(default_factory=list)


class MetadataEvidence(StrictModel):
    evidence_id: str
    source: Literal["title", "description", "tag"]
    text: str


class VideoAnalysisRequest(StrictModel):
    video_metadata: VideoMetadata
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    comment_samples: list["CommentSample"] = Field(default_factory=list)
    comment_signals: dict = Field(default_factory=dict)
    previous_stage_outputs: dict = Field(default_factory=dict)


class AsrResponse(StrictModel):
    source: Literal["asr"]
    language: str = "zh-CN"
    model_provider: str = "groq"
    model_name: str = "whisper-large-v3-turbo"
    content_text: str
    segments: list[TranscriptSegment]


class VideoClassificationResponse(StrictModel):
    schema_version: Literal["video_classification.v1"] = "video_classification.v1"
    video_id: str
    bvid: str
    is_shop_visit: bool
    content_type: ContentType
    confidence: float
    primary_city_hints: list[str] = Field(default_factory=list)
    primary_category_hints: list[str] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    need_manual_review: bool = False
    evidence_ids: list[str] = Field(default_factory=list)


class CommentSample(StrictModel):
    comment_id: str
    content: str
    like_count: int | None = None
    reply_count: int | None = None
    sample_type: str | None = None
    contains_location_signal: bool = False
    contains_shop_signal: bool = False


class LocationQuestion(StrictModel):
    text_summary: str
    count: int = Field(ge=0)
    evidence_ids: list[str] = Field(default_factory=list)


class ShopNameMention(StrictModel):
    candidate_name: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class AddressMention(StrictModel):
    text: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class AspectSentiment(StrictModel):
    sentiment: Sentiment
    summary: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class CommentSignalResponse(StrictModel):
    schema_version: Literal["comment_signal.v1"] = "comment_signal.v1"
    video_id: str
    sample_strategy: "SampleStrategy" = Field(default_factory=lambda: SampleStrategy())
    location_questions: list[LocationQuestion] = Field(default_factory=list)
    shop_name_mentions: list[ShopNameMention] = Field(default_factory=list)
    address_mentions: list[AddressMention] = Field(default_factory=list)
    status_mentions: list[dict[str, Any]] = Field(default_factory=list)
    aspect_sentiments: dict[str, AspectSentiment] = Field(default_factory=dict)
    risk_flags: list[RiskFlag] = Field(default_factory=list)

class CategoryPayload(StrictModel):
    primary: str | None = None
    secondary: str | None = None
    confidence: Confidence


class SampleStrategy(StrictModel):
    hot_comments_count: int = Field(default=0, ge=0)
    latest_comments_count: int = Field(default=0, ge=0)
    keyword_comments_count: int = Field(default=0, ge=0)


class LocationHints(StrictModel):
    country: str | None = None
    province: str | None = None
    city: str | None = None
    district: str | None = None
    business_area: str | None = None
    address_text: str | None = None
    landmarks: list[str] = Field(default_factory=list)
    confidence: Confidence


class TimeRange(StrictModel):
    start_sec: float | None = None
    end_sec: float | None = None


class CardConclusion(StrictModel):
    name: str | None = None
    text: str | None = None
    reason: str | None = None
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class CardPayload(StrictModel):
    display_title: str
    subtitle: str | None = None
    recommend_reason: str
    recommendation_score: Confidence | None
    recommendation_score_evidence_ids: list[str] = Field(default_factory=list)
    cover_source: str | None = None
    tags: list[str] = Field(default_factory=list)
    recommended_dishes: list[CardConclusion] = Field(default_factory=list)
    avoid_points: list[CardConclusion] = Field(default_factory=list)
    suitable_scenes: list[str] = Field(default_factory=list)


class ReviewDimension(StrictModel):
    sentiment: Sentiment
    summary: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class CommentSummary(StrictModel):
    positive_points: list[str] = Field(default_factory=list)
    negative_points: list[str] = Field(default_factory=list)
    controversial_points: list[str] = Field(default_factory=list)
    recent_status_points: list[str] = Field(default_factory=list)
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class StructuredVideoPayload(StrictModel):
    video_id: str
    bvid: str
    creator_id: str
    title: str
    content_type: ContentType
    is_shop_visit: bool
    overall_summary: str
    primary_city: str | None = None
    primary_categories: list[str] = Field(default_factory=list)
    analysis_confidence: Confidence
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)


class StructuredShopCandidate(StrictModel):
    candidate_id: str
    candidate_name: str | None
    normalized_name: str | None
    name_confidence: Confidence
    alias_names: list[str] = Field(default_factory=list)
    candidate_type: Literal["physical_shop", "unknown", "not_shop"]
    category: CategoryPayload
    location_hints: LocationHints
    time_range: TimeRange | None = None
    card_payload: CardPayload
    review_dimensions: dict[str, ReviewDimension] = Field(default_factory=dict)
    comment_summary: CommentSummary
    missing_fields: list[MissingField] = Field(default_factory=list)
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    manual_review_reasons: list[str] = Field(default_factory=list)


class VideoStructuredAnalysisResponse(StrictModel):
    schema_version: Literal["video_structured_analysis.v2"] = "video_structured_analysis.v2"
    video: StructuredVideoPayload
    shop_candidates: list[StructuredShopCandidate] = Field(default_factory=list)


class RelevantCommentFilterResponse(StrictModel):
    relevant_comment_ids: list[str] = Field(default_factory=list)


class TranscriptFactResponse(StrictModel):
    candidate_name: str | None = None
    name_confidence: Confidence = 0.0
    name_evidence_ids: list[str] = Field(default_factory=list)
    location_hints: LocationHints
    category: CategoryPayload


class TranscriptOpinionResponse(StrictModel):
    attitude: Literal["recommend", "conditional", "not_recommend", "unclear"]
    recommend_reason: str
    recommendation_score: Confidence | None
    recommendation_score_evidence_ids: list[str] = Field(default_factory=list)
    recommended_dishes: list[CardConclusion] = Field(default_factory=list)
    avoid_points: list[CardConclusion] = Field(default_factory=list)


class AiCallTrace(StrictModel):
    call_index: int = Field(ge=0)
    stage: str
    provider: str = "minimax"
    model: str
    prompt_version: str
    input_hash: str
    input_payload: dict[str, Any]
    output_payload: dict[str, Any] | None = None
    raw_output_text: str | None = None
    usage: dict[str, Any] = Field(default_factory=dict)
    status: Literal["success", "failed", "invalid_json", "schema_error"]
    error_message: str | None = None


class AiResponseEnvelope(StrictModel):
    output: dict[str, Any]
    provider: str = "minimax"
    model: str
    prompt_version: str
    usage: dict[str, Any] = Field(default_factory=dict)
    raw_output_text: str | None = None
    subcalls: list[AiCallTrace] = Field(default_factory=list)
