from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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


class VideoAnalysisRequest(BaseModel):
    video_metadata: VideoMetadata
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
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
    content_type: str
    confidence: float
    primary_city_hints: list[str] = Field(default_factory=list)
    primary_category_hints: list[str] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    need_manual_review: bool = False
    evidence_ids: list[str] = Field(default_factory=list)

