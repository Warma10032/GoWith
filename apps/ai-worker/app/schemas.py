from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator


def _coerce_confidence(value: object) -> object:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"high", "高", "high_confidence"}:
            return 0.85
        if normalized in {"medium", "mid", "中", "medium_confidence"}:
            return 0.6
        if normalized in {"low", "低", "low_confidence"}:
            return 0.35
    return value

Confidence = Annotated[float, BeforeValidator(_coerce_confidence), Field(ge=0, le=1)]
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
    "avg_price",
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


def _dict_list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _string_value(value: object) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _int_value(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    if isinstance(value, str):
        try:
            return max(0, int(float(value)))
        except ValueError:
            return default
    return default


def _list_strings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


class TranscriptSegment(BaseModel):
    segment_id: str | None = None
    start_sec: float
    end_sec: float
    text: str
    confidence: float | None = None


class VideoMetadata(BaseModel):
    video_id: str
    bvid: str
    creator_id: str
    title: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    category: str | None = None
    evidence: list["MetadataEvidence"] = Field(default_factory=list)


class MetadataEvidence(BaseModel):
    evidence_id: str
    source: Literal["title", "description", "tag"]
    text: str


class VideoAnalysisRequest(BaseModel):
    video_metadata: VideoMetadata
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    comment_samples: list["CommentSample"] = Field(default_factory=list)
    comment_signals: dict = Field(default_factory=dict)
    previous_stage_outputs: dict = Field(default_factory=dict)


class AsrResponse(BaseModel):
    source: Literal["asr"]
    language: str = "zh-CN"
    model_provider: str = "groq"
    model_name: str = "whisper-large-v3-turbo"
    content_text: str
    segments: list[TranscriptSegment]


class VideoClassificationResponse(BaseModel):
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


class CommentSample(BaseModel):
    comment_id: str
    content: str
    like_count: int | None = None
    reply_count: int | None = None
    sample_type: str | None = None
    contains_location_signal: bool = False
    contains_shop_signal: bool = False


class LocationQuestion(BaseModel):
    text_summary: str
    count: int = Field(ge=0)
    evidence_ids: list[str] = Field(default_factory=list)


class ShopNameMention(BaseModel):
    candidate_name: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class AddressMention(BaseModel):
    text: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class AspectSentiment(BaseModel):
    sentiment: Sentiment
    summary: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class CommentSignalResponse(BaseModel):
    schema_version: Literal["comment_signal.v1"] = "comment_signal.v1"
    video_id: str
    sample_strategy: "SampleStrategy" = Field(default_factory=lambda: SampleStrategy())
    location_questions: list[LocationQuestion] = Field(default_factory=list)
    shop_name_mentions: list[ShopNameMention] = Field(default_factory=list)
    address_mentions: list[AddressMention] = Field(default_factory=list)
    status_mentions: list[dict[str, Any]] = Field(default_factory=list)
    aspect_sentiments: dict[str, AspectSentiment] = Field(default_factory=dict)
    risk_flags: list[RiskFlag] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_model_output(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value

        normalized = dict(value)
        strategy = normalized.get("sample_strategy")
        if isinstance(strategy, dict):
            normalized["sample_strategy"] = {
                "hot_comments_count": _int_value(strategy.get("hot_comments_count")),
                "latest_comments_count": _int_value(strategy.get("latest_comments_count")),
                "keyword_comments_count": _int_value(strategy.get("keyword_comments_count")),
            }

        location_questions: list[dict[str, Any]] = []
        for item in _dict_list(normalized.get("location_questions")):
            text = (
                _string_value(item.get("text_summary"))
                or _string_value(item.get("summary"))
                or _string_value(item.get("question"))
                or _string_value(item.get("text"))
            )
            if text is None:
                continue
            location_questions.append(
                {
                    "text_summary": text,
                    "count": _int_value(item.get("count"), 1),
                    "evidence_ids": _list_strings(item.get("evidence_ids")),
                }
            )
        normalized["location_questions"] = location_questions

        shop_mentions: list[dict[str, Any]] = []
        for item in _dict_list(normalized.get("shop_name_mentions")):
            candidate_name = (
                _string_value(item.get("candidate_name"))
                or _string_value(item.get("name"))
                or _string_value(item.get("text"))
            )
            if candidate_name is None:
                continue
            shop_mentions.append(
                {
                    "candidate_name": candidate_name,
                    "confidence": item.get("confidence", 0.35),
                    "evidence_ids": _list_strings(item.get("evidence_ids")),
                }
            )
        normalized["shop_name_mentions"] = shop_mentions

        address_mentions: list[dict[str, Any]] = []
        for item in _dict_list(normalized.get("address_mentions")):
            text = (
                _string_value(item.get("text"))
                or _string_value(item.get("address"))
                or _string_value(item.get("address_text"))
            )
            if text is None:
                continue
            address_mentions.append(
                {
                    "text": text,
                    "confidence": item.get("confidence", 0.35),
                    "evidence_ids": _list_strings(item.get("evidence_ids")),
                }
            )
        normalized["address_mentions"] = address_mentions

        sentiments: dict[str, dict[str, Any]] = {}
        raw_sentiments = normalized.get("aspect_sentiments")
        if isinstance(raw_sentiments, dict):
            for key, item in raw_sentiments.items():
                if not isinstance(key, str) or not isinstance(item, dict):
                    continue
                summary = _string_value(item.get("summary"))
                if summary is None:
                    parts: list[str] = []
                    for field in ("positive", "negative", "controversial"):
                        values = _list_strings(item.get(field))
                        if values:
                            parts.append(f"{field}: {', '.join(values[:3])}")
                    summary = "; ".join(parts)
                sentiment = item.get("sentiment")
                if sentiment not in {"positive", "neutral", "negative", "mixed", "controversial", "unknown"}:
                    sentiment = "unknown"
                sentiments[key] = {
                    "sentiment": sentiment,
                    "summary": summary or "",
                    "confidence": item.get("confidence", 0.35),
                    "evidence_ids": _list_strings(item.get("evidence_ids")),
                }
        normalized["aspect_sentiments"] = sentiments
        return normalized


class CategoryPayload(BaseModel):
    primary: str | None = None
    secondary: str | None = None
    confidence: Confidence


class SampleStrategy(BaseModel):
    model_config = ConfigDict(extra="ignore")

    hot_comments_count: int = Field(default=0, ge=0)
    latest_comments_count: int = Field(default=0, ge=0)
    keyword_comments_count: int = Field(default=0, ge=0)


class LocationHints(BaseModel):
    country: str | None = None
    province: str | None = None
    city: str | None = None
    district: str | None = None
    business_area: str | None = None
    address_text: str | None = None
    landmarks: list[str] = Field(default_factory=list)
    confidence: Confidence


class TimeRange(BaseModel):
    start_sec: float | None = None
    end_sec: float | None = None


class CardConclusion(BaseModel):
    name: str | None = None
    text: str | None = None
    reason: str | None = None
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class CardPayload(BaseModel):
    display_title: str
    subtitle: str | None = None
    recommend_reason: str
    avg_price_hint: str | None = None
    cover_source: str | None = None
    tags: list[str] = Field(default_factory=list)
    recommended_dishes: list[CardConclusion] = Field(default_factory=list)
    avoid_points: list[CardConclusion] = Field(default_factory=list)
    suitable_scenes: list[str] = Field(default_factory=list)


class ReviewDimension(BaseModel):
    sentiment: Sentiment
    summary: str
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class CommentSummary(BaseModel):
    positive_points: list[str] = Field(default_factory=list)
    negative_points: list[str] = Field(default_factory=list)
    controversial_points: list[str] = Field(default_factory=list)
    recent_status_points: list[str] = Field(default_factory=list)
    confidence: Confidence
    evidence_ids: list[str] = Field(default_factory=list)


class StructuredVideoPayload(BaseModel):
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


class StructuredShopCandidate(BaseModel):
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


class VideoStructuredAnalysisResponse(BaseModel):
    schema_version: Literal["video_structured_analysis.v1"] = "video_structured_analysis.v1"
    video: StructuredVideoPayload
    shop_candidates: list[StructuredShopCandidate] = Field(default_factory=list)


class RelevantCommentFilterResponse(BaseModel):
    relevant_comment_ids: list[str] = Field(default_factory=list)


class TranscriptFactResponse(BaseModel):
    candidate_name: str | None = None
    name_confidence: Confidence = 0.0
    name_evidence_ids: list[str] = Field(default_factory=list)
    location_hints: LocationHints
    category: CategoryPayload


class TranscriptOpinionResponse(BaseModel):
    attitude: Literal["recommend", "conditional", "not_recommend", "unclear"]
    recommend_reason: str
    recommended_dishes: list[CardConclusion] = Field(default_factory=list)
    avoid_points: list[CardConclusion] = Field(default_factory=list)


class AiCallTrace(BaseModel):
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


class AiResponseEnvelope(BaseModel):
    output: dict[str, Any]
    provider: str = "minimax"
    model: str
    prompt_version: str
    usage: dict[str, Any] = Field(default_factory=dict)
    raw_output_text: str | None = None
    subcalls: list[AiCallTrace] = Field(default_factory=list)
