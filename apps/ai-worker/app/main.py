from __future__ import annotations

from fastapi import FastAPI, UploadFile

from .schemas import (
    AsrResponse,
    TranscriptSegment,
    VideoAnalysisRequest,
    VideoClassificationResponse,
)

app = FastAPI(title="GoWith AI Worker", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {"ok": True, "service": "ai-worker"}


@app.post("/asr/transcribe", response_model=AsrResponse)
async def transcribe_audio(file: UploadFile | None = None) -> AsrResponse:
    # MVP skeleton: real Groq upload is intentionally isolated behind this endpoint later.
    filename = file.filename if file else "mock-audio"
    text = f"{filename} 转写结果：这家店牛肉面分量足，高峰期排队。"
    return AsrResponse(
        source="asr",
        content_text=text,
        segments=[
            TranscriptSegment(start_sec=0, end_sec=8.5, text="这家店牛肉面分量足。", confidence=0.9),
            TranscriptSegment(start_sec=8.5, end_sec=15, text="高峰期排队会比较久。", confidence=0.88),
        ],
    )


@app.post("/ai/classify-video", response_model=VideoClassificationResponse)
async def classify_video(request: VideoAnalysisRequest) -> VideoClassificationResponse:
    title = request.video_metadata.title
    is_shop = any(keyword in title for keyword in ["探店", "牛肉面", "餐厅", "咖啡", "小店"])
    return VideoClassificationResponse(
        video_id=request.video_metadata.video_id,
        bvid=request.video_metadata.bvid,
        is_shop_visit=is_shop,
        content_type="single_shop_visit" if is_shop else "non_shop_visit",
        confidence=0.88 if is_shop else 0.91,
        primary_city_hints=["上海"] if is_shop else [],
        primary_category_hints=["restaurant"] if is_shop else [],
        reason_codes=["mentions_physical_shop", "mentions_food_or_menu"] if is_shop else ["explicit_non_shop_context"],
        risk_flags=[],
        need_manual_review=False,
        evidence_ids=[],
    )


@app.post("/ai/extract-shop-candidates")
async def extract_shop_candidates(request: VideoAnalysisRequest) -> dict:
    return {
        "video_id": request.video_metadata.video_id,
        "shops": [
            {
                "candidate_name": "某某牛肉面",
                "name_confidence": 0.78,
                "city_hints": ["上海"],
                "district_hints": ["黄浦"],
                "address_hints": ["南京东路附近"],
                "shop_type": "restaurant",
                "mentioned_dishes": ["牛肉面"],
                "price_hints": ["约30元"],
                "evidence": [],
                "missing_fields": ["exact_address"],
            }
        ],
    }


@app.post("/ai/comment-signals")
async def comment_signals(request: VideoAnalysisRequest) -> dict:
    return {
        "schema_version": "comment_signal.v1",
        "video_id": request.video_metadata.video_id,
        "sample_strategy": {
            "hot_comments_count": 1,
            "latest_comments_count": 1,
            "keyword_comments_count": 1,
        },
        "location_questions": [],
        "shop_name_mentions": [
            {"candidate_name": "某某牛肉面", "confidence": 0.72, "evidence_ids": []}
        ],
        "address_mentions": [
            {"text": "南京东路附近", "confidence": 0.68, "evidence_ids": []}
        ],
        "status_mentions": [],
        "aspect_sentiments": {},
        "risk_flags": [],
    }


@app.post("/ai/structure-video")
async def structure_video(request: VideoAnalysisRequest) -> dict:
    metadata = request.video_metadata
    return {
        "schema_version": "video_structured_analysis.v1",
        "video": {
            "video_id": metadata.video_id,
            "bvid": metadata.bvid,
            "creator_id": metadata.creator_id,
            "title": metadata.title,
            "content_type": "single_shop_visit",
            "is_shop_visit": True,
            "overall_summary": "视频介绍一家上海南京东路附近的日常面馆。",
            "primary_city": "上海市",
            "primary_categories": ["restaurant"],
            "analysis_confidence": 0.84,
            "risk_flags": ["address_missing"],
            "evidence_ids": [],
        },
        "shop_candidates": [
            {
                "candidate_id": "mock_candidate",
                "candidate_name": "某某牛肉面",
                "normalized_name": "某某牛肉面",
                "name_confidence": 0.78,
                "alias_names": ["某某面馆"],
                "candidate_type": "physical_shop",
                "category": {
                    "primary": "restaurant",
                    "secondary": "noodle_shop",
                    "confidence": 0.81,
                },
                "location_hints": {
                    "country": "中国",
                    "province": "上海市",
                    "city": "上海市",
                    "district": "黄浦区",
                    "business_area": "南京东路",
                    "address_text": "南京东路附近",
                    "landmarks": ["南京东路"],
                    "confidence": 0.65,
                },
                "time_range": {"start_sec": 18, "end_sec": 338},
                "card_payload": {
                    "display_title": "某某牛肉面",
                    "subtitle": "适合一人食的日常面馆",
                    "recommend_reason": "牛肉分量足，汤底浓，适合顺路吃一顿。",
                    "avg_price_hint": "约30元",
                    "cover_source": "video_cover",
                    "tags": ["一人食", "分量足", "排队"],
                    "recommended_dishes": [],
                    "avoid_points": [],
                    "suitable_scenes": ["一人食", "工作日午餐"],
                },
                "review_dimensions": {},
                "comment_summary": {
                    "positive_points": ["分量足"],
                    "negative_points": ["排队久"],
                    "controversial_points": [],
                    "recent_status_points": [],
                    "confidence": 0.7,
                    "evidence_ids": [],
                },
                "missing_fields": ["exact_address", "opening_hours", "phone"],
                "risk_flags": ["address_missing"],
                "manual_review_reasons": ["地址线索不完整，需要 POI 人工确认。"],
            }
        ],
    }
