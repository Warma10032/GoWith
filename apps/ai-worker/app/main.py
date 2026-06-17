from __future__ import annotations

import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, TypedDict

import httpx
from fastapi import FastAPI, HTTPException, UploadFile

from .schemas import (
    AsrResponse,
    TranscriptSegment,
    VideoAnalysisRequest,
    VideoClassificationResponse,
)

app = FastAPI(title="GoWith AI Worker", version="0.1.0")

GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


class GroqSegment(TypedDict):
    start_sec: float
    end_sec: float
    text: str
    confidence: float | None


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {"ok": True, "service": "ai-worker"}


@app.post("/asr/transcribe", response_model=AsrResponse)
async def transcribe_audio(file: UploadFile | None = None) -> AsrResponse:
    if _is_live_mode():
        if file is None:
            raise HTTPException(status_code=400, detail="audio_file_required")
        return await _transcribe_with_groq(file)

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

def _is_live_mode() -> bool:
    return os.getenv("EXTERNAL_MODE", "mock") in {"real", "live"}


def _groq_model() -> str:
    return os.getenv("GROQ_ASR_MODEL", "whisper-large-v3-turbo")


def _groq_max_bytes() -> int:
    mb = int(os.getenv("GROQ_ASR_MAX_MB", "25"))
    return mb * 1024 * 1024


def _chunk_seconds() -> int:
    return int(os.getenv("ASR_CHUNK_SECONDS", "600"))


async def _run_ffmpeg(args: list[str]) -> None:
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="ignore")[:1000]
        raise HTTPException(status_code=500, detail=f"ffmpeg_failed: {message}")


async def _prepare_audio_chunks(source: Path, workdir: Path) -> list[Path]:
    normalized = workdir / "normalized.flac"
    await _run_ffmpeg(["-y", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "flac", str(normalized)])
    if normalized.stat().st_size <= _groq_max_bytes():
        return [normalized]

    pattern = workdir / "chunk_%03d.flac"
    await _run_ffmpeg(
        [
            "-y",
            "-i",
            str(source),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "segment",
            "-segment_time",
            str(_chunk_seconds()),
            "-c:a",
            "flac",
            str(pattern),
        ],
    )
    chunks = sorted(workdir.glob("chunk_*.flac"))
    if not chunks:
        raise HTTPException(status_code=500, detail="asr_chunking_failed")
    oversized = [chunk.name for chunk in chunks if chunk.stat().st_size > _groq_max_bytes()]
    if oversized:
        raise HTTPException(status_code=413, detail=f"asr_chunk_too_large: {', '.join(oversized[:3])}")
    return chunks


async def _transcribe_with_groq(file: UploadFile) -> AsrResponse:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="groq_api_key_missing")

    suffix = Path(file.filename or "audio.m4s").suffix or ".m4s"
    with TemporaryDirectory(prefix="gowith-asr-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        source = temp_dir / f"source{suffix}"
        source.write_bytes(await file.read())
        chunks = await _prepare_audio_chunks(source, temp_dir)
        text_parts: list[str] = []
        segments: list[TranscriptSegment] = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0)) as client:
            for index, chunk in enumerate(chunks):
                result = await _groq_transcribe_chunk(client, api_key, chunk)
                chunk_text = str(result.get("text") or "").strip()
                if chunk_text:
                    text_parts.append(chunk_text)
                offset = index * _chunk_seconds() if len(chunks) > 1 else 0
                for raw_segment in _extract_groq_segments(result):
                    segments.append(
                        TranscriptSegment(
                            start_sec=raw_segment["start_sec"] + offset,
                            end_sec=raw_segment["end_sec"] + offset,
                            text=raw_segment["text"],
                            confidence=raw_segment["confidence"],
                        )
                    )

        return AsrResponse(
            source="asr",
            language="zh-CN",
            model_provider="groq",
            model_name=_groq_model(),
            content_text="\n".join(text_parts),
            segments=segments,
        )


async def _groq_transcribe_chunk(client: httpx.AsyncClient, api_key: str, chunk: Path) -> dict[str, Any]:
    with chunk.open("rb") as audio:
        response = await client.post(
            GROQ_TRANSCRIPTIONS_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            data={
                "model": _groq_model(),
                "response_format": "verbose_json",
                "timestamp_granularities[]": "segment",
            },
            files={"file": (chunk.name, audio, "audio/flac")},
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"groq_asr_failed: {response.text[:1000]}")
    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="groq_asr_invalid_response")
    return payload


def _extract_groq_segments(payload: dict[str, Any]) -> list[GroqSegment]:
    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list):
        text = str(payload.get("text") or "").strip()
        return [GroqSegment(start_sec=0.0, end_sec=0.0, text=text, confidence=None)] if text else []

    segments: list[GroqSegment] = []
    for item in raw_segments:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        start = _float_value(item.get("start"))
        end = _float_value(item.get("end"))
        start_sec = start if start is not None else 0.0
        end_sec = end if end is not None else start_sec
        segments.append(GroqSegment(start_sec=start_sec, end_sec=end_sec, text=text, confidence=_float_value(item.get("avg_logprob"))))
    return segments


def _float_value(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


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
