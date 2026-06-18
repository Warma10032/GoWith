from __future__ import annotations

import asyncio
import json
import math
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal, TypedDict, TypeVar

import httpx
from fastapi import FastAPI, HTTPException, UploadFile
from openai import APIError, AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel, ValidationError

from .schemas import (
    AiResponseEnvelope,
    AsrResponse,
    CommentSignalResponse,
    TranscriptSegment,
    VideoAnalysisRequest,
    VideoClassificationResponse,
    VideoStructuredAnalysisResponse,
)

app = FastAPI(title="GoWith AI Worker", version="0.1.0")

GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MINIMAX_PROVIDER = "minimax"
ALLOWED_RISK_FLAGS = {
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
}
ALLOWED_MISSING_FIELDS = {
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
}
ALLOWED_CONTENT_TYPES = {
    "single_shop_visit",
    "multi_shop_visit",
    "city_food_collection",
    "travel_vlog_with_shops",
    "food_review_not_shop",
    "not_physical_shop",
    "non_shop_visit",
    "unknown",
}
ALLOWED_SENTIMENTS = {"positive", "neutral", "negative", "mixed", "controversial", "unknown"}

T = TypeVar("T", bound=BaseModel)


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


def _minimax_model() -> str:
    return os.getenv("MINIMAX_MODEL", "MiniMax-M3")


def _minimax_base_url() -> str:
    return os.getenv("MINIMAX_BASE_URL", "https://api.minimaxi.com/v1")


def _minimax_temperature() -> float:
    return float(os.getenv("MINIMAX_TEMPERATURE", "0.1"))


def _minimax_max_completion_tokens() -> int:
    return int(os.getenv("MINIMAX_MAX_COMPLETION_TOKENS", "8192"))


def _minimax_timeout_seconds() -> float:
    return float(os.getenv("MINIMAX_REQUEST_TIMEOUT_SECONDS", "180"))


def _minimax_client() -> AsyncOpenAI:
    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="minimax_api_key_missing")
    return AsyncOpenAI(api_key=api_key, base_url=_minimax_base_url(), timeout=_minimax_timeout_seconds())


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
        segments.append(
            GroqSegment(
                start_sec=start_sec,
                end_sec=end_sec,
                text=text,
                confidence=_confidence_from_avg_logprob(item.get("avg_logprob")),
            )
        )
    return segments


def _confidence_from_avg_logprob(value: object) -> float | None:
    avg_logprob = _float_value(value)
    if avg_logprob is None or not math.isfinite(avg_logprob):
        return None
    return min(1.0, max(0.0, math.exp(avg_logprob)))


def _float_value(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _string_or_none(value: object) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _string_list(value: object, limit: int | None = None) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return items[:limit] if limit is not None else items


def _filtered_string_list(value: object, allowed: set[str]) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item in allowed]


def _confidence_value(value: object, default: float = 0.5) -> object:
    confidence = _float_value(value)
    if confidence is not None:
        return min(1.0, max(0.0, confidence))
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"high", "高", "high_confidence"}:
            return 0.85
        if normalized in {"medium", "mid", "中", "medium_confidence"}:
            return 0.6
        if normalized in {"low", "低", "low_confidence"}:
            return 0.35
    return default


def _conclusion_items(value: object, field: Literal["name", "text"]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for raw_item in value[:5]:
        if isinstance(raw_item, str) and raw_item.strip():
            items.append({field: raw_item.strip(), "confidence": 0.5, "evidence_ids": []})
            continue
        if isinstance(raw_item, dict):
            item = dict(raw_item)
            item[field] = (
                _string_or_none(item.get(field))
                or _string_or_none(item.get("name"))
                or _string_or_none(item.get("text"))
                or _string_or_none(item.get("reason"))
            )
            if item[field] is None:
                continue
            item["confidence"] = _confidence_value(item.get("confidence"), 0.5)
            item["evidence_ids"] = _string_list(item.get("evidence_ids"))
            items.append(item)
    return items


def _metadata_dict(request: VideoAnalysisRequest) -> dict[str, Any]:
    return request.video_metadata.model_dump(mode="json")


def _input_payload(request: VideoAnalysisRequest) -> dict[str, Any]:
    return {
        "video_metadata": _metadata_dict(request),
        "transcript_segments": [segment.model_dump(mode="json") for segment in request.transcript_segments],
        "comment_samples": [comment.model_dump(mode="json") for comment in request.comment_samples],
        "comment_signals": request.comment_signals,
        "previous_stage_outputs": request.previous_stage_outputs,
    }


def _system_prompt(stage: str) -> str:
    return (
        "你是 GoWith 的 B站探店内容结构化分析器。"
        "只能根据输入材料输出结论，不要编造店名、地址、价格、菜品、营业状态。"
        "信息不足时使用 unknown/null/[]，并在 missing_fields 或 risk_flags 中标记。"
        "所有 evidence_ids 必须来自输入中的 segment_id/comment_id/title/description/tag 证据 ID。"
        "content_type 只能使用：single_shop_visit, multi_shop_visit, city_food_collection, "
        "travel_vlog_with_shops, food_review_not_shop, not_physical_shop, non_shop_visit, unknown。"
        "risk_flags 只能使用：non_shop_visit_possible, shop_name_missing, shop_name_ambiguous, "
        "generic_name_risk, multiple_shops_in_video, address_missing, city_missing, poi_no_candidate, "
        "poi_low_confidence, poi_many_same_name_candidates, chain_store_branch_uncertain, "
        "closed_or_moved_mentioned, comment_conflict, asr_low_quality, subtitle_missing, "
        "insufficient_evidence, ai_output_incomplete, needs_manual_review。"
        "sentiment 只能使用：positive, neutral, negative, mixed, controversial, unknown。"
        "missing_fields 只能使用：shop_name, city, district, business_area, exact_address, poi, "
        "avg_price, opening_hours, phone, recommended_dishes, avoid_points, service, environment, "
        "queue, parking, reservation。"
        f"当前阶段：{stage}。只输出合法 JSON，不要 Markdown，不要解释。"
    )


def _user_prompt(stage: str, request: VideoAnalysisRequest) -> str:
    schema_hint = {
        "classify_video": (
            "输出 video_classification.v1 JSON，字段包括 schema_version, video_id, bvid, "
            "is_shop_visit, content_type, confidence, primary_city_hints, "
            "primary_category_hints, reason_codes, risk_flags, need_manual_review, evidence_ids。"
        ),
        "comment_signal": (
            "输出 comment_signal.v1 JSON，字段包括 schema_version, video_id, sample_strategy, "
            "location_questions, shop_name_mentions, address_mentions, status_mentions, "
            "aspect_sentiments, risk_flags。"
        ),
        "structure_video": (
            "输出 video_structured_analysis.v1 JSON，字段包括 video 与 shop_candidates。"
            "shop_candidates 必须足以支撑大众点评式店铺卡片；无法确定店名时 candidate_name=null。"
            "MVP smoke 首版最多输出 1 个最主要的 shop_candidate。"
            "所有 summary/reason 控制在 80 个中文字符以内；tags/recommended_dishes/"
            "avoid_points/suitable_scenes 每项最多 5 个。"
        ),
    }[stage]
    return json.dumps(
        {
            "task": schema_hint,
            "input": _input_payload(request),
        },
        ensure_ascii=False,
    )


def _extract_json_text(text: str) -> str:
    stripped = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        stripped = fence.group(1).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end >= start:
        return stripped[start : end + 1]
    return stripped


def _parse_json_output(text: str) -> dict[str, Any]:
    try:
        value = json.loads(_extract_json_text(text))
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail=f"minimax_invalid_json: {error}") from error
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="minimax_json_not_object")
    return value


def _normalize_review_dimensions(value: object) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for key, raw_item in value.items():
        if not isinstance(key, str):
            continue
        if isinstance(raw_item, str):
            normalized[key] = {
                "sentiment": "unknown",
                "summary": raw_item,
                "confidence": 0.35,
                "evidence_ids": [],
            }
            continue
        if not isinstance(raw_item, dict):
            continue
        sentiment = raw_item.get("sentiment")
        normalized[key] = {
            "sentiment": sentiment if sentiment in ALLOWED_SENTIMENTS else "unknown",
            "summary": _string_or_none(raw_item.get("summary")) or "",
            "confidence": _confidence_value(raw_item.get("confidence"), 0.35),
            "evidence_ids": _string_list(raw_item.get("evidence_ids")),
        }
    return normalized


def _normalize_comment_summary(value: object) -> dict[str, Any]:
    if isinstance(value, str):
        return {
            "positive_points": [],
            "negative_points": [],
            "controversial_points": [],
            "recent_status_points": [value],
            "confidence": 0.35,
            "evidence_ids": [],
        }
    if not isinstance(value, dict):
        return {
            "positive_points": [],
            "negative_points": [],
            "controversial_points": [],
            "recent_status_points": [],
            "confidence": 0.35,
            "evidence_ids": [],
        }
    return {
        "positive_points": _string_list(value.get("positive_points"), 5)
        or _string_list(value.get("pros"), 5)
        or _string_list(value.get("positive"), 5),
        "negative_points": _string_list(value.get("negative_points"), 5)
        or _string_list(value.get("cons"), 5)
        or _string_list(value.get("negative"), 5),
        "controversial_points": _string_list(value.get("controversial_points"), 5)
        or _string_list(value.get("controversial"), 5),
        "recent_status_points": _string_list(value.get("recent_status_points"), 5)
        or _string_list(value.get("status"), 5),
        "confidence": _confidence_value(value.get("confidence"), 0.35),
        "evidence_ids": _string_list(value.get("evidence_ids")),
    }


def _normalize_shop_candidate(raw_candidate: object, index: int, request: VideoAnalysisRequest) -> dict[str, Any]:
    candidate: dict[str, Any] = dict(raw_candidate) if isinstance(raw_candidate, dict) else {}
    card_obj = candidate.get("card_payload")
    card: dict[str, Any] = dict(card_obj) if isinstance(card_obj, dict) else {}

    candidate_name = (
        _string_or_none(candidate.get("candidate_name"))
        or _string_or_none(candidate.get("shop_name"))
        or _string_or_none(candidate.get("name"))
        or _string_or_none(card.get("shop_name"))
        or _string_or_none(card.get("display_title"))
    )
    category = candidate.get("category")
    category_payload: dict[str, Any]
    if isinstance(category, str):
        category_payload = {"primary": category, "secondary": None, "confidence": 0.5}
    elif isinstance(category, dict):
        secondary = category.get("secondary")
        secondary_list = _string_list(secondary, 1)
        category_payload = {
            "primary": _string_or_none(category.get("primary")),
            "secondary": _string_or_none(secondary) or (secondary_list[0] if secondary_list else None),
            "confidence": _confidence_value(category.get("confidence"), 0.5),
        }
    else:
        category_payload = {"primary": None, "secondary": None, "confidence": 0.35}

    location = candidate.get("location_hints")
    location_payload: dict[str, Any]
    if isinstance(location, list):
        location_payload = {
            "country": "中国",
            "province": None,
            "city": None,
            "district": None,
            "business_area": None,
            "address_text": " ".join(_string_list(location)),
            "landmarks": [],
            "confidence": 0.5,
        }
    elif isinstance(location, dict):
        location_payload = {
            "country": _string_or_none(location.get("country")) or "中国",
            "province": _string_or_none(location.get("province")),
            "city": _string_or_none(location.get("city")),
            "district": _string_or_none(location.get("district")),
            "business_area": _string_or_none(location.get("business_area")),
            "address_text": (
                _string_or_none(location.get("address_text"))
                or _string_or_none(location.get("address"))
                or _string_or_none(location.get("address_evidence"))
                or _string_or_none(location.get("exact_address"))
            ),
            "landmarks": _string_list(location.get("landmarks"), 5),
            "confidence": _confidence_value(location.get("confidence"), 0.5),
        }
    else:
        location_payload = {
            "country": "中国",
            "province": None,
            "city": None,
            "district": None,
            "business_area": None,
            "address_text": None,
            "landmarks": [],
            "confidence": 0.35,
        }

    candidate_type = candidate.get("candidate_type")
    if candidate_type not in {"physical_shop", "unknown", "not_shop"}:
        candidate_type = "physical_shop" if candidate_name else "unknown"
    display_title = (
        _string_or_none(card.get("display_title"))
        or candidate_name
        or _string_or_none(request.video_metadata.title)
        or "unknown"
    )
    recommend_reason = (
        _string_or_none(card.get("recommend_reason"))
        or _string_or_none(card.get("reason"))
        or _string_or_none(candidate.get("summary"))
        or "信息不足，需要人工复核。"
    )
    return {
        "candidate_id": _string_or_none(candidate.get("candidate_id")) or f"candidate_{index + 1}",
        "candidate_name": candidate_name,
        "normalized_name": _string_or_none(candidate.get("normalized_name")) or candidate_name,
        "name_confidence": _confidence_value(candidate.get("name_confidence") or candidate.get("confidence"), 0.5),
        "alias_names": _string_list(candidate.get("alias_names"), 5),
        "candidate_type": candidate_type,
        "category": category_payload,
        "location_hints": location_payload,
        "time_range": candidate.get("time_range") if isinstance(candidate.get("time_range"), dict) else None,
        "card_payload": {
            "display_title": display_title,
            "subtitle": _string_or_none(card.get("subtitle")),
            "recommend_reason": recommend_reason,
            "avg_price_hint": _string_or_none(card.get("avg_price_hint")) or _string_or_none(card.get("price")),
            "cover_source": _string_or_none(card.get("cover_source")),
            "tags": _string_list(card.get("tags"), 5),
            "recommended_dishes": _conclusion_items(card.get("recommended_dishes"), "name"),
            "avoid_points": _conclusion_items(card.get("avoid_points"), "text"),
            "suitable_scenes": _string_list(card.get("suitable_scenes"), 5),
        },
        "review_dimensions": _normalize_review_dimensions(candidate.get("review_dimensions")),
        "comment_summary": _normalize_comment_summary(candidate.get("comment_summary")),
        "missing_fields": _filtered_string_list(candidate.get("missing_fields"), ALLOWED_MISSING_FIELDS),
        "risk_flags": _filtered_string_list(candidate.get("risk_flags"), ALLOWED_RISK_FLAGS),
        "manual_review_reasons": _string_list(candidate.get("manual_review_reasons"), 5),
    }


def _normalize_structured_payload(parsed: dict[str, Any], request: VideoAnalysisRequest) -> dict[str, Any]:
    metadata = request.video_metadata
    normalized = dict(parsed)
    raw_video_obj = parsed.get("video")
    raw_video: dict[str, Any] = dict(raw_video_obj) if isinstance(raw_video_obj, dict) else {}
    classification_obj = request.previous_stage_outputs.get("classification")
    classification: dict[str, Any] = dict(classification_obj) if isinstance(classification_obj, dict) else {}
    content_type = raw_video.get("content_type") or classification.get("content_type")
    if content_type not in ALLOWED_CONTENT_TYPES:
        content_type = "unknown"
    normalized["schema_version"] = "video_structured_analysis.v1"
    normalized["video"] = {
        "video_id": _string_or_none(raw_video.get("video_id")) or metadata.video_id,
        "bvid": _string_or_none(raw_video.get("bvid")) or metadata.bvid,
        "creator_id": _string_or_none(raw_video.get("creator_id")) or metadata.creator_id,
        "title": _string_or_none(raw_video.get("title")) or metadata.title,
        "content_type": content_type,
        "is_shop_visit": bool(raw_video.get("is_shop_visit", classification.get("is_shop_visit", False))),
        "overall_summary": _string_or_none(raw_video.get("overall_summary"))
        or _string_or_none(raw_video.get("summary"))
        or metadata.title,
        "primary_city": _string_or_none(raw_video.get("primary_city")),
        "primary_categories": _string_list(raw_video.get("primary_categories"), 5),
        "analysis_confidence": _confidence_value(raw_video.get("analysis_confidence") or raw_video.get("confidence"), 0.5),
        "risk_flags": _filtered_string_list(raw_video.get("risk_flags"), ALLOWED_RISK_FLAGS),
        "evidence_ids": _string_list(raw_video.get("evidence_ids")),
    }
    candidates = parsed.get("shop_candidates")
    normalized["shop_candidates"] = [
        _normalize_shop_candidate(candidate, index, request)
        for index, candidate in enumerate(candidates if isinstance(candidates, list) else [])
    ][:1]
    return normalized


def _normalize_common_payload(stage: str, parsed: dict[str, Any], request: VideoAnalysisRequest) -> dict[str, Any]:
    if stage == "structure_video":
        return _normalize_structured_payload(parsed, request)
    if stage in {"classify_video", "comment_signal"}:
        normalized = dict(parsed)
        normalized["risk_flags"] = _filtered_string_list(parsed.get("risk_flags"), ALLOWED_RISK_FLAGS)
        return normalized
    return parsed


def _usage_dict(response: Any) -> dict[str, Any]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}
    if hasattr(usage, "model_dump"):
        dumped = usage.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    if isinstance(usage, dict):
        return usage
    return {}


async def _chat_completion(messages: list[ChatCompletionMessageParam]) -> tuple[str, dict[str, Any]]:
    try:
        response = await _minimax_client().chat.completions.create(
            model=_minimax_model(),
            messages=messages,
            temperature=_minimax_temperature(),
            max_completion_tokens=_minimax_max_completion_tokens(),
            response_format={"type": "json_object"},
            extra_body={"thinking": {"type": "disabled"}},
        )
    except APIError as error:
        raise HTTPException(status_code=502, detail=f"minimax_api_error: {error}") from error
    message = response.choices[0].message if response.choices else None
    content = getattr(message, "content", None) if message else None
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=502, detail="minimax_empty_response")
    return content, _usage_dict(response)


async def _repair_json(stage: str, raw_output_text: str, error_message: str) -> tuple[str, dict[str, Any]]:
    return await _chat_completion(
        [
            {"role": "system", "content": _system_prompt(f"{stage}:json_repair")},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "error": error_message,
                        "raw_output_text": raw_output_text,
                        "instruction": "修复为符合目标 schema 的单个 JSON object，只输出 JSON。",
                    },
                    ensure_ascii=False,
                ),
            },
        ]
    )


async def _minimax_structured_call(
    stage: Literal["classify_video", "comment_signal", "structure_video"],
    request: VideoAnalysisRequest,
    response_model: type[T],
) -> AiResponseEnvelope:
    prompt_version = f"{stage}.v1.minimax"
    raw_output_text, usage = await _chat_completion(
        [
            {"role": "system", "content": _system_prompt(stage)},
            {"role": "user", "content": _user_prompt(stage, request)},
        ]
    )
    try:
        parsed = _parse_json_output(raw_output_text)
        parsed = _normalize_common_payload(stage, parsed, request)
        validated = response_model.model_validate(parsed)
    except (HTTPException, ValidationError) as error:
        repair_text, repair_usage = await _repair_json(stage, raw_output_text, str(error))
        try:
            parsed = _parse_json_output(repair_text)
            parsed = _normalize_common_payload(stage, parsed, request)
            validated = response_model.model_validate(parsed)
            raw_output_text = repair_text
            usage = {**usage, "repair": repair_usage}
        except (HTTPException, ValidationError) as repair_error:
            raise HTTPException(status_code=502, detail=f"minimax_schema_error: {repair_error}") from repair_error

    return AiResponseEnvelope(
        output=validated.model_dump(mode="json"),
        provider=MINIMAX_PROVIDER,
        model=_minimax_model(),
        prompt_version=prompt_version,
        usage=usage,
        raw_output_text=raw_output_text,
    )


def _mock_envelope(output: BaseModel | dict[str, Any], prompt_version: str, model: str) -> AiResponseEnvelope:
    payload = output.model_dump(mode="json") if isinstance(output, BaseModel) else output
    return AiResponseEnvelope(
        output=payload,
        provider="mock",
        model=model,
        prompt_version=prompt_version,
        usage={},
        raw_output_text=json.dumps(payload, ensure_ascii=False),
    )


@app.post("/ai/classify-video", response_model=AiResponseEnvelope)
async def classify_video(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    if _is_live_mode():
        return await _minimax_structured_call("classify_video", request, VideoClassificationResponse)
    title = request.video_metadata.title
    is_shop = any(keyword in title for keyword in ["探店", "牛肉面", "餐厅", "咖啡", "小店"])
    output = VideoClassificationResponse(
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
    return _mock_envelope(output, "classify_video.v1", "mock-classifier")


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


@app.post("/ai/comment-signals", response_model=AiResponseEnvelope)
async def comment_signals(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    if _is_live_mode():
        return await _minimax_structured_call("comment_signal", request, CommentSignalResponse)
    output = {
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
    return _mock_envelope(output, "comment_signal.v1", "mock-comment-signal")


@app.post("/ai/structure-video", response_model=AiResponseEnvelope)
async def structure_video(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    if _is_live_mode():
        return await _minimax_structured_call("structure_video", request, VideoStructuredAnalysisResponse)
    metadata = request.video_metadata
    output = {
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
    return _mock_envelope(output, "structure_video.v1", "mock-structure-video")
