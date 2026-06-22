from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Callable, Literal, TypedDict, TypeVar

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from openai import APIError, AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel, ValidationError

from .schemas import (
    AiCallTrace,
    AiResponseEnvelope,
    AsrResponse,
    CommentSignalResponse,
    RelevantCommentFilterResponse,
    TranscriptFactResponse,
    TranscriptOpinionResponse,
    TranscriptSegment,
    VideoAnalysisRequest,
    VideoClassificationResponse,
    VideoStructuredAnalysisResponse,
)
from .prompts import build_messages, prompt_spec

# 启动时加载 monorepo 根目录的 .env（override=False，shell 注入优先）。
# 这样 `pnpm dev` / `uv run` / IDE 调试 / CI 容器都能读到 MINIMAX_API_KEY 等。
# main.py 在 apps/ai-worker/app/，所以 parents[3] = monorepo 根。
_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(_ROOT / ".env", override=False)

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
PRIMARY_SHOP_CATEGORIES = (
    "中餐",
    "地方特色菜",
    "火锅",
    "烧烤",
    "海鲜",
    "自助餐",
    "小吃快餐",
    "粉面粥",
    "甜品饮品",
    "咖啡烘焙",
    "西餐",
    "日本料理",
    "韩国料理",
    "东南亚菜",
    "素食",
    "其他餐饮",
)
SECONDARY_CUISINES = (
    "鲁菜",
    "粤菜",
    "潮汕菜",
    "客家菜",
    "川菜",
    "湘菜",
    "江浙菜",
    "东北菜",
    "西北菜",
    "云贵菜",
    "新疆菜",
    "清真菜",
    "家常菜",
    "私房菜",
    "农家菜",
    "创意菜",
)
COMMENT_SIGNAL_RISK_FLAGS = {
    "closed_or_moved_mentioned",
    "comment_conflict",
    "insufficient_evidence",
}
AI_DISALLOWED_RISK_FLAGS = {"needs_manual_review"}
VAGUE_REVIEW_TEXT_PATTERNS = (
    "信息不足",
    "人工复核",
    "人工审核",
    "需要复核",
    "需要审核",
    "待复核",
    "待审核",
    "不清楚",
    "无法判断",
)
INLINE_EVIDENCE_ID_PATTERN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
INLINE_SHORT_EVIDENCE_ID_PATTERN = re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{8}(?![0-9a-fA-F])")

T = TypeVar("T", bound=BaseModel)


class AiWorkflowError(Exception):
    def __init__(self, message: str, subcalls: list[AiCallTrace]) -> None:
        super().__init__(message)
        self.message = message
        self.subcalls = subcalls


@app.exception_handler(AiWorkflowError)
async def ai_workflow_error_handler(_: Request, error: AiWorkflowError) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "detail": error.message,
            "subcalls": [call.model_dump(mode="json") for call in error.subcalls],
        },
    )


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
    if file is None:
        raise HTTPException(status_code=400, detail="audio_file_required")
    return await _transcribe_with_groq(file)


def _groq_model() -> str:
    return os.getenv("GROQ_ASR_MODEL", "whisper-large-v3-turbo")


def _minimax_simple_model() -> str:
    return os.getenv("MINIMAX_SIMPLE_MODEL", "MiniMax-M2.7")


def _minimax_complex_model() -> str:
    return os.getenv("MINIMAX_COMPLEX_MODEL", os.getenv("MINIMAX_MODEL", "MiniMax-M3"))


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
    return AsyncOpenAI(
        api_key=api_key, base_url=_minimax_base_url(), timeout=_minimax_timeout_seconds()
    )


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
    await _run_ffmpeg(
        ["-y", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "flac", str(normalized)]
    )
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
        raise HTTPException(
            status_code=413, detail=f"asr_chunk_too_large: {', '.join(oversized[:3])}"
        )
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


async def _groq_transcribe_chunk(
    client: httpx.AsyncClient, api_key: str, chunk: Path
) -> dict[str, Any]:
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


def _filtered_ai_risk_flags(value: object) -> list[str]:
    return [
        item
        for item in _filtered_string_list(value, ALLOWED_RISK_FLAGS)
        if item not in AI_DISALLOWED_RISK_FLAGS
    ]


def _is_vague_review_text(value: str | None) -> bool:
    if value is None:
        return True
    normalized = value.strip()
    if not normalized:
        return True
    return any(pattern in normalized for pattern in VAGUE_REVIEW_TEXT_PATTERNS)


def _confidence_value(value: object, default: float = 0.5) -> float:
    confidence = _float_value(value)
    if confidence is not None:
        return min(1.0, max(0.0, confidence))
    return default


def _conclusion_items(value: object, field: Literal["name", "text"]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for raw_item in value[:5]:
        if isinstance(raw_item, dict):
            item = dict(raw_item)
            item[field] = _string_or_none(item.get(field))
            if item[field] is None:
                continue
            item["confidence"] = _confidence_value(item.get("confidence"), 0.5)
            item["evidence_ids"] = _string_list(item.get("evidence_ids"))
            items.append(item)
    return items


def _metadata_dict(request: VideoAnalysisRequest) -> dict[str, Any]:
    return request.video_metadata.model_dump(mode="json")


def _compact_text_blocks(
    items: list[dict[str, Any]], text_keys: tuple[str, ...], limit: int = 8
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for item in items:
        block: dict[str, Any] = {}
        for key in text_keys:
            text = _string_or_none(item.get(key))
            if text is not None:
                block[key] = text
        evidence_ids = _string_list(item.get("evidence_ids"), 3)
        if evidence_ids:
            block["evidence_ids"] = evidence_ids
        confidence = _confidence_value(item.get("confidence"), 0.0)
        if isinstance(confidence, (int, float)) and confidence:
            block["confidence"] = confidence
        if block:
            blocks.append(block)
    return blocks[:limit]


def _comment_signal_brief(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    shop_names = value.get("shop_name_mentions")
    addresses = value.get("address_mentions")
    statuses = value.get("status_mentions")
    sentiments = value.get("aspect_sentiments")
    return {
        "shop_name_mentions": _compact_text_blocks(
            [item for item in shop_names if isinstance(item, dict)]
            if isinstance(shop_names, list)
            else [],
            ("candidate_name",),
        ),
        "address_mentions": _compact_text_blocks(
            [item for item in addresses if isinstance(item, dict)]
            if isinstance(addresses, list)
            else [],
            ("text",),
        ),
        "status_mentions": _compact_text_blocks(
            [item for item in statuses if isinstance(item, dict)]
            if isinstance(statuses, list)
            else [],
            ("text",),
        ),
        "aspect_sentiments": sentiments if isinstance(sentiments, dict) else {},
        "risk_flags": _filtered_ai_risk_flags(value.get("risk_flags")),
    }


def _previous_outputs_brief(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    classification = value.get("classification")
    return {
        "classification": classification if isinstance(classification, dict) else {},
        "commentSignals": _comment_signal_brief(value.get("commentSignals")),
        "transcriptInsights": value.get("transcriptInsights")
        if isinstance(value.get("transcriptInsights"), dict)
        else {},
    }


def _representative_items(items: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if len(items) <= limit:
        return items
    if limit <= 1:
        return items[:limit]
    indexes = {round(index * (len(items) - 1) / (limit - 1)) for index in range(limit)}
    return [item for index, item in enumerate(items) if index in indexes]


def _input_payload(
    request: VideoAnalysisRequest, *, include_raw_comments: bool = False
) -> dict[str, Any]:
    transcript_segments = [
        segment.model_dump(mode="json") for segment in request.transcript_segments
    ]
    comment_samples = [comment.model_dump(mode="json") for comment in request.comment_samples]
    if request.previous_stage_outputs:
        transcript_segments = _representative_items(transcript_segments, 240)
        if not include_raw_comments:
            # The structure stage consumes the dedicated comment-signal result instead of
            # paying for the same raw comments a second time.
            comment_samples = []
    return {
        "video_metadata": _metadata_dict(request),
        "transcript_segments": transcript_segments,
        "comment_samples": comment_samples,
        "comment_signals": _comment_signal_brief(request.comment_signals),
        "previous_stage_outputs": _previous_outputs_brief(request.previous_stage_outputs),
    }


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


def _escape_unescaped_string_quotes(text: str) -> str:
    """Escape obvious prose quotes inside JSON strings.

    MiniMax occasionally emits Chinese prose such as `标题以"不好找"点明`,
    where the inner ASCII quotes are not escaped. A quote can only terminate a
    JSON string when the next non-whitespace character is structural. Keep the
    repair deliberately narrow; the caller still requires json.loads to accept
    the entire repaired document.
    """
    repaired: list[str] = []
    in_string = False
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and in_string:
            repaired.append(char)
            index += 1
            if index < len(text):
                repaired.append(text[index])
            index += 1
            continue
        if char != '"':
            repaired.append(char)
            index += 1
            continue
        if not in_string:
            in_string = True
            repaired.append(char)
            index += 1
            continue

        lookahead = index + 1
        while lookahead < len(text) and text[lookahead].isspace():
            lookahead += 1
        next_char = text[lookahead] if lookahead < len(text) else None
        if next_char is None or next_char in ",:}]":
            in_string = False
            repaired.append(char)
        else:
            repaired.append('\\"')
        index += 1
    return "".join(repaired)


def _parse_json_output(text: str) -> dict[str, Any]:
    extracted = _extract_json_text(text)
    try:
        value = json.loads(extracted)
    except json.JSONDecodeError as error:
        try:
            value = json.loads(_escape_unescaped_string_quotes(extracted))
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=502, detail=f"minimax_invalid_json: {error}"
            ) from error
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="minimax_json_not_object")
    return value


def _normalize_transcript_fact_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    location = parsed.get("location_hints")
    if not isinstance(location, dict) or isinstance(location.get("landmarks"), list):
        return parsed
    return {
        **parsed,
        "location_hints": {
            **location,
            "landmarks": [],
        },
    }


def _normalize_review_dimensions(value: object) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for key, raw_item in value.items():
        if not isinstance(key, str):
            continue
        if not isinstance(raw_item, dict):
            continue
        sentiment = raw_item.get("sentiment")
        summary = _string_or_none(raw_item.get("summary")) or ""
        summary = INLINE_EVIDENCE_ID_PATTERN.sub("", summary)
        summary = INLINE_SHORT_EVIDENCE_ID_PATTERN.sub("", summary)
        summary = re.sub(r"（[、，,\s]*）", "", summary)
        summary = re.sub(r"([、，,]\s*){2,}", "、", summary).strip(" 、，,")
        confidence = _confidence_value(raw_item.get("confidence"), 0.35)
        evidence_ids = _string_list(raw_item.get("evidence_ids"))
        if (
            not summary
            or summary.startswith(("无明确", "无到店", "暂无", "未提及"))
            or "无明确评价" in summary
            or confidence <= 0.4
            or not evidence_ids
        ):
            continue
        normalized[key] = {
            "sentiment": sentiment if sentiment in ALLOWED_SENTIMENTS else "unknown",
            "summary": summary,
            "confidence": confidence,
            "evidence_ids": evidence_ids,
        }
    return normalized


def _normalize_comment_summary(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {
            "positive_points": [],
            "negative_points": [],
            "controversial_points": [],
            "recent_status_points": [],
            "confidence": 0.35,
            "evidence_ids": [],
        }
    if "status_mentions" in value or "aspect_sentiments" in value:
        status_points: list[str] = []
        for item in value.get("status_mentions", []):
            if not isinstance(item, dict):
                continue
            text = _string_or_none(item.get("text"))
            if text is not None:
                status_points.append(text)
        positive_points: list[str] = []
        negative_points: list[str] = []
        controversial_points: list[str] = []
        evidence_ids: list[str] = []
        sentiments = value.get("aspect_sentiments")
        if isinstance(sentiments, dict):
            for key, raw_item in sentiments.items():
                if not isinstance(key, str) or not isinstance(raw_item, dict):
                    continue
                summary = _string_or_none(raw_item.get("summary"))
                if not summary:
                    continue
                sentiment = raw_item.get("sentiment")
                evidence_ids.extend(_string_list(raw_item.get("evidence_ids")))
                text = f"{key}: {summary}"
                if sentiment == "positive":
                    positive_points.append(text)
                elif sentiment == "negative":
                    negative_points.append(text)
                elif sentiment in {"mixed", "controversial"}:
                    controversial_points.append(text)
        return {
            "positive_points": positive_points[:5],
            "negative_points": negative_points[:5],
            "controversial_points": controversial_points[:5],
            "recent_status_points": status_points[:5],
            "confidence": 0.5
            if status_points or positive_points or negative_points or controversial_points
            else 0.35,
            "evidence_ids": list(dict.fromkeys(evidence_ids)),
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


def _comment_signals_from_request(request: VideoAnalysisRequest) -> dict[str, Any]:
    signals = request.comment_signals
    if isinstance(signals, dict) and signals:
        return signals
    previous = request.previous_stage_outputs.get("commentSignals")
    return previous if isinstance(previous, dict) else {}


def _first_signal_text(signals: dict[str, Any], field: str, keys: tuple[str, ...]) -> str | None:
    items = signals.get(field)
    if not isinstance(items, list):
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        for key in keys:
            text = _string_or_none(item.get(key))
            if text is not None:
                return text
    return None


def _infer_city_from_inputs(request: VideoAnalysisRequest, signals: dict[str, Any]) -> str | None:
    tags = request.video_metadata.tags
    title = request.video_metadata.title
    known_city_tokens = (
        "北京",
        "上海",
        "广州",
        "深圳",
        "杭州",
        "成都",
        "重庆",
        "南京",
        "武汉",
        "西安",
        "苏州",
        "天津",
        "长沙",
        "厦门",
        "佛山",
        "东莞",
        "烟台",
        "番禺",
    )
    for token in known_city_tokens:
        if token in tags or token in title:
            return "广州" if token == "番禺" else token
    address = _first_signal_text(signals, "address_mentions", ("text", "address", "address_text"))
    if address:
        for token in known_city_tokens:
            if token in address:
                return "广州" if token == "番禺" else token
    return None


def _infer_district_from_inputs(
    request: VideoAnalysisRequest, signals: dict[str, Any]
) -> str | None:
    title = request.video_metadata.title
    tags = request.video_metadata.tags
    address = (
        _first_signal_text(signals, "address_mentions", ("text", "address", "address_text")) or ""
    )
    for token in (
        "番禺",
        "黄埔",
        "天河",
        "越秀",
        "海珠",
        "荔湾",
        "白云",
        "南沙",
        "花都",
        "增城",
        "从化",
    ):
        if token in title or token in tags or token in address:
            return token
    return None


def _specific_recommend_reason(
    card: dict[str, Any],
) -> str:
    existing = _string_or_none(card.get("recommend_reason"))
    if (
        not _is_vague_review_text(existing)
        and existing is not None
        and "标题" not in existing
        and "地点" not in existing
    ):
        return existing or ""

    dishes = [
        item["name"]
        for item in _conclusion_items(card.get("recommended_dishes"), "name")
        if item.get("name") and item.get("evidence_ids")
    ]
    if dishes:
        return f"博主在字幕中推荐{'、'.join(dishes[:3])}。"
    return ""


def _category_text(request: VideoAnalysisRequest) -> str:
    transcript = " ".join(segment.text for segment in request.transcript_segments)
    return " ".join(
        [
            request.video_metadata.title,
            request.video_metadata.description or "",
            *request.video_metadata.tags,
            transcript,
        ]
    )


def _normalized_category(value: object, request: VideoAnalysisRequest) -> dict[str, Any]:
    category = value if isinstance(value, dict) else {}
    primary = _string_or_none(category.get("primary"))
    secondary = _string_or_none(category.get("secondary"))
    primary = primary if primary in PRIMARY_SHOP_CATEGORIES else None
    secondary = secondary if secondary in SECONDARY_CUISINES else None
    text = _category_text(request)
    specialty_tokens = ("钟村三宝", "中村三宝", "田鼠", "龙虱", "桂花蝉")
    if (
        any(token in text for token in specialty_tokens[:2])
        or sum(token in text for token in specialty_tokens[2:]) >= 2
    ):
        primary = "地方特色菜"

    if primary is None:
        primary_keywords = (
            ("自助餐", ("自助",)),
            ("火锅", ("火锅", "涮锅")),
            ("烧烤", ("烧烤", "烤串", "炭烤")),
            ("海鲜", ("海鲜", "生蚝", "海产")),
            ("咖啡烘焙", ("咖啡", "面包", "烘焙")),
            ("甜品饮品", ("甜品", "糖水", "奶茶")),
            ("粉面粥", ("粉", "面馆", "粥")),
            ("地方特色菜", ("三宝", "田鼠", "龙虱", "桂花蝉", "地方特色")),
        )
        primary = next(
            (
                name
                for name, keywords in primary_keywords
                if any(keyword in text for keyword in keywords)
            ),
            "中餐",
        )

    if secondary is None:
        cuisine_keywords = (
            ("鲁菜", ("鲁菜", "山东", "烟台", "青岛")),
            ("潮汕菜", ("潮汕", "潮州", "汕头")),
            ("客家菜", ("客家",)),
            ("粤菜", ("广东", "广州", "番禺", "顺德", "粤菜")),
            ("川菜", ("川菜", "四川")),
            ("湘菜", ("湘菜", "湖南")),
            ("东北菜", ("东北菜", "东北")),
            ("西北菜", ("西北菜", "西北")),
        )
        secondary = next(
            (
                name
                for name, keywords in cuisine_keywords
                if any(keyword in text for keyword in keywords)
            ),
            None,
        )

    return {
        "primary": primary,
        "secondary": secondary,
        "confidence": _confidence_value(category.get("confidence"), 0.5),
    }


def _normalize_shop_candidate(
    raw_candidate: object, index: int, request: VideoAnalysisRequest
) -> dict[str, Any]:
    candidate: dict[str, Any] = dict(raw_candidate) if isinstance(raw_candidate, dict) else {}
    card_obj = candidate.get("card_payload")
    card: dict[str, Any] = dict(card_obj) if isinstance(card_obj, dict) else {}
    comment_signals = _comment_signals_from_request(request)
    insights_obj = request.previous_stage_outputs.get("transcriptInsights")
    insights: dict[str, Any] = dict(insights_obj) if isinstance(insights_obj, dict) else {}
    current_reason = _string_or_none(card.get("recommend_reason"))
    if _is_vague_review_text(current_reason) or (current_reason and "标题" in current_reason):
        card["recommend_reason"] = insights.get("recommend_reason")
    if not _conclusion_items(card.get("recommended_dishes"), "name"):
        card["recommended_dishes"] = insights.get("recommended_dishes")
    if not _conclusion_items(card.get("avoid_points"), "text"):
        card["avoid_points"] = insights.get("avoid_points")
    if card.get("recommendation_score") is None:
        card["recommendation_score"] = insights.get("recommendation_score")
    if not _string_list(card.get("recommendation_score_evidence_ids")):
        card["recommendation_score_evidence_ids"] = insights.get(
            "recommendation_score_evidence_ids"
        )

    candidate_name = (
        _string_or_none(candidate.get("candidate_name"))
        or _string_or_none(insights.get("candidate_name"))
        or _string_or_none(card.get("display_title"))
        or _first_signal_text(
            comment_signals, "shop_name_mentions", ("candidate_name",)
        )
    )
    raw_category = candidate.get("category")
    insight_category = insights.get("category")
    if isinstance(insight_category, dict):
        raw_category = insight_category
    category_payload = _normalized_category(raw_category, request)

    location = candidate.get("location_hints")
    location_payload: dict[str, Any]
    if isinstance(location, dict):
        location_payload = {
            "country": _string_or_none(location.get("country")) or "中国",
            "province": _string_or_none(location.get("province")),
            "city": _string_or_none(location.get("city")),
            "district": _string_or_none(location.get("district")),
            "business_area": _string_or_none(location.get("business_area")),
            "address_text": _string_or_none(location.get("address_text")),
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
    if location_payload["city"] is None:
        location_payload["city"] = _infer_city_from_inputs(request, comment_signals)
    if location_payload["district"] is None:
        location_payload["district"] = _infer_district_from_inputs(request, comment_signals)
    if location_payload["address_text"] is None:
        location_payload["address_text"] = _first_signal_text(
            comment_signals, "address_mentions", ("text",)
        )

    candidate_type = candidate.get("candidate_type")
    if candidate_type not in {"physical_shop", "unknown", "not_shop"}:
        candidate_type = "physical_shop" if candidate_name else "unknown"
    display_title = (
        _string_or_none(card.get("display_title"))
        or candidate_name
        or _string_or_none(request.video_metadata.title)
        or "unknown"
    )
    recommend_reason = _specific_recommend_reason(
        card,
    )
    comment_summary = _normalize_comment_summary(
        candidate.get("comment_summary") or comment_signals
    )
    signal_summary = _normalize_comment_summary(comment_signals)
    comment_summary["evidence_ids"] = list(
        dict.fromkeys(
            [
                *_string_list(comment_summary.get("evidence_ids")),
                *_string_list(signal_summary.get("evidence_ids")),
            ]
        )
    )
    return {
        "candidate_id": _string_or_none(candidate.get("candidate_id")) or f"candidate_{index + 1}",
        "candidate_name": candidate_name,
        "normalized_name": _string_or_none(candidate.get("normalized_name")) or candidate_name,
        "name_confidence": _confidence_value(
            candidate.get("name_confidence"), 0.5
        ),
        "alias_names": _string_list(candidate.get("alias_names"), 5),
        "candidate_type": candidate_type,
        "category": category_payload,
        "location_hints": location_payload,
        "time_range": candidate.get("time_range")
        if isinstance(candidate.get("time_range"), dict)
        else None,
        "card_payload": {
            "display_title": display_title,
            "subtitle": _string_or_none(card.get("subtitle")),
            "recommend_reason": recommend_reason,
            "recommendation_score": (
                _confidence_value(card.get("recommendation_score"), 0.0)
                if card.get("recommendation_score") is not None
                else None
            ),
            "recommendation_score_evidence_ids": _string_list(
                card.get("recommendation_score_evidence_ids")
            ),
            "avg_price_hint": _string_or_none(card.get("avg_price_hint")),
            "cover_source": _string_or_none(card.get("cover_source")),
            "tags": [],
            "recommended_dishes": _conclusion_items(card.get("recommended_dishes"), "name"),
            "avoid_points": _conclusion_items(card.get("avoid_points"), "text"),
            "suitable_scenes": _string_list(card.get("suitable_scenes"), 5),
        },
        "review_dimensions": _normalize_review_dimensions(
            comment_signals.get("aspect_sentiments")
        ),
        "comment_summary": comment_summary,
        "missing_fields": _filtered_string_list(
            candidate.get("missing_fields"), ALLOWED_MISSING_FIELDS
        ),
        "risk_flags": _filtered_ai_risk_flags(candidate.get("risk_flags")),
        "manual_review_reasons": [],
    }


def _normalize_structured_payload(
    parsed: dict[str, Any], request: VideoAnalysisRequest
) -> dict[str, Any]:
    metadata = request.video_metadata
    normalized = dict(parsed)
    raw_video_obj = parsed.get("video")
    raw_video: dict[str, Any] = dict(raw_video_obj) if isinstance(raw_video_obj, dict) else {}
    classification_obj = request.previous_stage_outputs.get("classification")
    classification: dict[str, Any] = (
        dict(classification_obj) if isinstance(classification_obj, dict) else {}
    )
    content_type = raw_video.get("content_type") or classification.get("content_type")
    if content_type not in ALLOWED_CONTENT_TYPES:
        content_type = "unknown"
    # 品类提示：优先本阶段 AI 输出，没有则继承 classify 阶段的 primary_category_hints。
    # 这样链路上"分类阶段出 hint → 结构化阶段消费并精修"的语义是连贯的。
    primary_categories = _string_list(raw_video.get("primary_categories"), 5)
    if not primary_categories:
        primary_categories = _string_list(classification.get("primary_category_hints"), 5)
    normalized["schema_version"] = "video_structured_analysis.v1"
    normalized["video"] = {
        "video_id": _string_or_none(raw_video.get("video_id")) or metadata.video_id,
        "bvid": _string_or_none(raw_video.get("bvid")) or metadata.bvid,
        "creator_id": _string_or_none(raw_video.get("creator_id")) or metadata.creator_id,
        "title": _string_or_none(raw_video.get("title")) or metadata.title,
        "content_type": content_type,
        "is_shop_visit": bool(
            raw_video.get("is_shop_visit", classification.get("is_shop_visit", False))
        ),
        "overall_summary": _string_or_none(raw_video.get("overall_summary"))
        or metadata.title,
        "primary_city": _string_or_none(raw_video.get("primary_city")),
        "primary_categories": primary_categories,
        "analysis_confidence": _confidence_value(
            raw_video.get("analysis_confidence"), 0.5
        ),
        "risk_flags": _filtered_ai_risk_flags(raw_video.get("risk_flags")),
        "evidence_ids": _string_list(raw_video.get("evidence_ids")),
    }
    candidates = parsed.get("shop_candidates")
    candidate_items = candidates if isinstance(candidates, list) else []
    normalized["shop_candidates"] = [
        _normalize_shop_candidate(candidate, index, request)
        for index, candidate in enumerate(candidate_items)
    ][:1]
    return normalized


def _normalize_common_payload(
    stage: str, parsed: dict[str, Any], request: VideoAnalysisRequest
) -> dict[str, Any]:
    if stage == "structure_video":
        return _normalize_structured_payload(parsed, request)
    if stage in {"classify_video", "comment_signal"}:
        normalized = dict(parsed)
        normalized["risk_flags"] = _filtered_ai_risk_flags(parsed.get("risk_flags"))
        if stage == "comment_signal":
            normalized["risk_flags"] = [
                flag for flag in normalized["risk_flags"] if flag in COMMENT_SIGNAL_RISK_FLAGS
            ]
            hot_count = sum(1 for item in request.comment_samples if item.sample_type == "hot")
            latest_count = sum(
                1 for item in request.comment_samples if item.sample_type == "latest"
            )
            keyword_count = sum(
                1
                for item in request.comment_samples
                if item.sample_type == "keyword"
                or item.contains_location_signal
                or item.contains_shop_signal
            )
            normalized["sample_strategy"] = {
                "hot_comments_count": hot_count,
                "latest_comments_count": latest_count,
                "keyword_comments_count": keyword_count,
            }
            sentiments = normalized.get("aspect_sentiments")
            if isinstance(sentiments, dict):
                normalized["aspect_sentiments"] = {
                    key: value
                    for key, value in sentiments.items()
                    if isinstance(value, dict)
                    and _string_or_none(value.get("summary")) is not None
                    and value.get("sentiment") != "unknown"
                }
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


async def _chat_completion(
    messages: list[ChatCompletionMessageParam],
    *,
    model: str,
) -> tuple[str, dict[str, Any]]:
    try:
        response = await _minimax_client().chat.completions.create(
            model=model,
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
    return content, {**_usage_dict(response), "model": model}


def _model_for_prompt(key: str) -> str:
    return (
        _minimax_simple_model()
        if prompt_spec(key).model_tier == "simple"
        else _minimax_complex_model()
    )


def _messages_hash(messages: list[ChatCompletionMessageParam]) -> str:
    payload = json.dumps(messages, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def _prompt_call(
    key: str,
    context: dict[str, Any],
    response_model: type[T],
    subcalls: list[AiCallTrace],
    normalizer: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    *,
    allow_json_repair: bool = True,
) -> T:
    spec = prompt_spec(key)
    model = _model_for_prompt(key)
    messages = build_messages(key, context, response_model)
    input_hash = _messages_hash(messages)
    raw_output_text: str | None = None
    usage: dict[str, Any] = {}
    try:
        raw_output_text, usage = await _chat_completion(messages, model=model)
        parsed = _parse_json_output(raw_output_text)
        if normalizer is not None:
            parsed = normalizer(parsed)
        validated = response_model.model_validate(parsed)
    except HTTPException as error:
        status: Literal["invalid_json", "failed"] = (
            "invalid_json"
            if str(error.detail).startswith("minimax_invalid_json")
            else "failed"
        )
        subcalls.append(
            AiCallTrace(
                call_index=len(subcalls),
                stage=spec.key,
                model=model,
                prompt_version=spec.version,
                input_hash=input_hash,
                input_payload=context,
                raw_output_text=raw_output_text,
                usage=usage,
                status=status,
                error_message=str(error.detail),
            )
        )
        if allow_json_repair and raw_output_text:
            return await _prompt_call(
                "json_repair",
                {
                    "target_prompt": spec.key,
                    "validation_error": str(error.detail),
                    "raw_output_text": raw_output_text,
                },
                response_model,
                subcalls,
                normalizer,
                allow_json_repair=False,
            )
        raise AiWorkflowError(str(error.detail), subcalls) from error
    except ValidationError as error:
        subcalls.append(
            AiCallTrace(
                call_index=len(subcalls),
                stage=spec.key,
                model=model,
                prompt_version=spec.version,
                input_hash=input_hash,
                input_payload=context,
                output_payload=parsed,
                raw_output_text=raw_output_text,
                usage=usage,
                status="schema_error",
                error_message=str(error),
            )
        )
        if allow_json_repair and raw_output_text:
            return await _prompt_call(
                "json_repair",
                {
                    "target_prompt": spec.key,
                    "validation_error": str(error),
                    "raw_output_text": raw_output_text,
                },
                response_model,
                subcalls,
                normalizer,
                allow_json_repair=False,
            )
        raise AiWorkflowError(f"minimax_schema_error: {error}", subcalls) from error

    output = validated.model_dump(mode="json")
    subcalls.append(
        AiCallTrace(
            call_index=len(subcalls),
            stage=spec.key,
            model=model,
            prompt_version=spec.version,
            input_hash=input_hash,
            input_payload=context,
            output_payload=output,
            raw_output_text=raw_output_text,
            usage=usage,
            status="success",
        )
    )
    return validated


def _envelope(key: str, output: BaseModel, subcalls: list[AiCallTrace]) -> AiResponseEnvelope:
    spec = prompt_spec(key)
    successful = [call for call in subcalls if call.status == "success"]
    last_call = successful[-1] if successful else None
    return AiResponseEnvelope(
        output=output.model_dump(mode="json"),
        provider=MINIMAX_PROVIDER,
        model=_model_for_prompt(key),
        prompt_version=spec.version,
        usage={"calls": [call.usage for call in subcalls]},
        raw_output_text=last_call.raw_output_text if last_call else None,
        subcalls=subcalls,
    )


def _structure_semantic_issues(
    result: VideoStructuredAnalysisResponse,
    request: VideoAnalysisRequest,
) -> list[str]:
    issues: list[str] = []
    facts = request.previous_stage_outputs.get("transcriptFacts")
    fact_name = _string_or_none(facts.get("candidate_name")) if isinstance(facts, dict) else None
    if (
        result.video.is_shop_visit
        and result.video.content_type == "single_shop_visit"
        and fact_name
        and not result.shop_candidates
    ):
        issues.append("single_shop_visit_missing_candidate")
    if not result.video.evidence_ids:
        issues.append("video_missing_evidence")
    for candidate in result.shop_candidates:
        if (
            candidate.card_payload.recommendation_score is not None
            and not candidate.card_payload.recommendation_score_evidence_ids
        ):
            issues.append(f"{candidate.candidate_id}:recommendation_score_missing_evidence")
        for dish in candidate.card_payload.recommended_dishes:
            if not dish.evidence_ids:
                issues.append(f"{candidate.candidate_id}:dish_missing_evidence")
    return issues


@app.post("/ai/classify-video", response_model=AiResponseEnvelope)
async def classify_video(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    subcalls: list[AiCallTrace] = []
    result = await _prompt_call(
        "classify_video",
        _input_payload(request),
        VideoClassificationResponse,
        subcalls,
        lambda parsed: _normalize_common_payload("classify_video", parsed, request),
    )
    return _envelope("classify_video", result, subcalls)


@app.post("/ai/comment-signals", response_model=AiResponseEnvelope)
async def comment_signals(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    subcalls: list[AiCallTrace] = []
    relevant_ids: set[str] = set()
    if request.comment_samples:
        filtered = await _prompt_call(
            "comment_relevance_filter",
            {
                "video_metadata": _metadata_dict(request),
                "transcript_context": _representative_items(
                    [item.model_dump(mode="json") for item in request.transcript_segments], 80
                ),
                "comment_samples": [
                    item.model_dump(mode="json") for item in request.comment_samples
                ],
            },
            RelevantCommentFilterResponse,
            subcalls,
        )
        allowed_ids = {comment.comment_id for comment in request.comment_samples}
        relevant_ids = set(filtered.relevant_comment_ids) & allowed_ids
    filtered_request = request.model_copy(
        update={
            "comment_samples": [
                comment for comment in request.comment_samples if comment.comment_id in relevant_ids
            ]
        }
    )
    result = await _prompt_call(
        "comment_analysis",
        _input_payload(filtered_request, include_raw_comments=True),
        CommentSignalResponse,
        subcalls,
        lambda parsed: _normalize_common_payload("comment_signal", parsed, filtered_request),
    )
    return _envelope("comment_analysis", result, subcalls)


@app.post("/ai/structure-video", response_model=AiResponseEnvelope)
async def structure_video(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    subcalls: list[AiCallTrace] = []
    transcript_context = {
        "video_metadata": _metadata_dict(request),
        "transcript_segments": [
            segment.model_dump(mode="json") for segment in request.transcript_segments
        ],
    }
    facts = await _prompt_call(
        "transcript_fact_extraction",
        {
            **transcript_context,
            "allowed_primary_categories": list(PRIMARY_SHOP_CATEGORIES),
            "allowed_secondary_cuisines": list(SECONDARY_CUISINES),
        },
        TranscriptFactResponse,
        subcalls,
        _normalize_transcript_fact_payload,
    )
    opinions = await _prompt_call(
        "transcript_opinion_analysis",
        {**transcript_context, "transcript_facts": facts.model_dump(mode="json")},
        TranscriptOpinionResponse,
        subcalls,
    )
    insights = {**facts.model_dump(mode="json"), **opinions.model_dump(mode="json")}
    previous_outputs = {
        **request.previous_stage_outputs,
        "transcriptFacts": facts.model_dump(mode="json"),
        "transcriptOpinion": opinions.model_dump(mode="json"),
        "transcriptInsights": insights,
    }
    enriched_request = request.model_copy(update={"previous_stage_outputs": previous_outputs})
    def normalize_structure(parsed: dict[str, Any]) -> dict[str, Any]:
        return _normalize_common_payload("structure_video", parsed, enriched_request)

    result = await _prompt_call(
        "structure_synthesis",
        _input_payload(enriched_request),
        VideoStructuredAnalysisResponse,
        subcalls,
        normalize_structure,
    )
    issues = _structure_semantic_issues(result, enriched_request)
    if issues:
        result = await _prompt_call(
            "structure_semantic_retry",
            {
                "input": _input_payload(enriched_request),
                "previous_output": result.model_dump(mode="json"),
                "validation_errors": issues,
            },
            VideoStructuredAnalysisResponse,
            subcalls,
            normalize_structure,
        )
        remaining_issues = _structure_semantic_issues(result, enriched_request)
        if remaining_issues:
            raise AiWorkflowError(
                f"structure_semantic_error: {', '.join(remaining_issues)}", subcalls
            )
    return _envelope("structure_synthesis", result, subcalls)
