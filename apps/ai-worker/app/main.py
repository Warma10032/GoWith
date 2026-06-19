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
    if file is None:
        raise HTTPException(status_code=400, detail="audio_file_required")
    return await _transcribe_with_groq(file)


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
            ("candidate_name", "text", "name"),
        ),
        "address_mentions": _compact_text_blocks(
            [item for item in addresses if isinstance(item, dict)]
            if isinstance(addresses, list)
            else [],
            ("text", "address", "address_text"),
        ),
        "status_mentions": _compact_text_blocks(
            [item for item in statuses if isinstance(item, dict)]
            if isinstance(statuses, list)
            else [],
            ("text", "summary", "status", "note"),
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


def _input_payload(request: VideoAnalysisRequest) -> dict[str, Any]:
    transcript_segments = [
        segment.model_dump(mode="json") for segment in request.transcript_segments
    ]
    comment_samples = [comment.model_dump(mode="json") for comment in request.comment_samples]
    if request.previous_stage_outputs:
        transcript_segments = _representative_items(transcript_segments, 240)
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


def _system_prompt(stage: str) -> str:
    return (
        "你是 GoWith 的 B站探店内容结构化分析器。"
        "只能根据输入材料输出结论，不要编造店名、地址、价格、菜品、营业状态。"
        "信息不足时使用 unknown/null/[] 或空字符串，不要写“信息不足”“人工复核”“需要审核”等占位文案。"
        "不要输出 needs_manual_review；如果有风险，只输出具体风险，例如 address_missing 或 insufficient_evidence。"
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
            "aspect_sentiments, risk_flags。评论样本都属于当前视频，评论无需重复店名也可以作为菜品和口味评价证据。"
            "必须逐条阅读评论，优先聚合 taste、dish_recommendation、value_for_money、service、environment、queue 六个维度；"
            "例如评论明确说某菜好吃、值得一试、难以接受时，应写入对应维度并引用 comment_id。"
            "只有真实出现互相矛盾的结论才输出 comment_conflict；没有店名或地址不属于评论分析风险。"
            "没有提到的维度不要凑数，不要输出空 summary 的 unknown 维度。"
        ),
        "structure_video": (
            "输出 video_structured_analysis.v1 JSON，字段包括 video 与 shop_candidates。"
            "这是递进阶段：必须优先使用 previous_stage_outputs.classification 和 comment_signals，"
            "再结合标题、标签、字幕分段生成店铺候选。标题、标签、评论线索中明确出现的城市、店名、地址片段必须保留。"
            "shop_candidates 必须足以支撑大众点评式店铺卡片；无法确定店名时 candidate_name=null。"
            "MVP smoke 首版最多输出 1 个最主要的 shop_candidate。"
            "category.primary 必须从以下主类选择一个或 null："
            f"{', '.join(PRIMARY_SHOP_CATEGORIES)}；category.secondary 必须从以下菜系选择一个或 null："
            f"{', '.join(SECONDARY_CUISINES)}。不得自由创造品类。"
            "必须完整分析提供的字幕时序，先判断博主态度是推荐、有条件推荐、不推荐还是未明确，再提取具体推荐菜和理由。"
            "recommend_reason 必须总结博主态度、推荐或不推荐的菜品及字幕中的味道/口感/性价比理由，"
            "例如“博主推荐田鼠，认为肉质嫩、咸香；桂花蝉仅建议猎奇尝试”。不得复述标题、地点或店名充当推荐理由。"
            "recommended_dishes 和 avoid_points 的每项必须带字幕 segment_id 作为 evidence_ids；评论不能替代博主结论。"
            "所有 summary/reason 控制在 100 个中文字符以内；recommended_dishes/avoid_points/suitable_scenes 每项最多 5 个。"
            "tags 固定输出空数组。没有字幕证据时 recommend_reason 输出空字符串。"
            "comment_summary 必须吸收 comment_signals 中明确的正负面、地址、营业状态线索；没有就输出空数组。"
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
        summary = _string_or_none(raw_item.get("summary")) or ""
        summary = INLINE_EVIDENCE_ID_PATTERN.sub("", summary)
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
    if "status_mentions" in value or "aspect_sentiments" in value:
        status_points: list[str] = []
        for item in value.get("status_mentions", []):
            if not isinstance(item, dict):
                continue
            text = (
                _string_or_none(item.get("text"))
                or _string_or_none(item.get("summary"))
                or _string_or_none(item.get("note"))
                or _string_or_none(item.get("status"))
            )
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
    existing = _string_or_none(card.get("recommend_reason")) or _string_or_none(card.get("reason"))
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

    candidate_name = (
        _string_or_none(candidate.get("candidate_name"))
        or _string_or_none(candidate.get("shop_name"))
        or _string_or_none(candidate.get("name"))
        or _string_or_none(card.get("shop_name"))
        or _string_or_none(card.get("display_title"))
        or _first_signal_text(
            comment_signals, "shop_name_mentions", ("candidate_name", "name", "text")
        )
    )
    raw_category = candidate.get("category")
    insight_category = insights.get("category")
    if isinstance(insight_category, dict):
        raw_category = insight_category
    if isinstance(raw_category, str):
        raw_category = {"primary": raw_category, "secondary": None, "confidence": 0.5}
    category_payload = _normalized_category(raw_category, request)

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
    if location_payload["city"] is None:
        location_payload["city"] = _infer_city_from_inputs(request, comment_signals)
    if location_payload["district"] is None:
        location_payload["district"] = _infer_district_from_inputs(request, comment_signals)
    if location_payload["address_text"] is None:
        location_payload["address_text"] = _first_signal_text(
            comment_signals, "address_mentions", ("text", "address", "address_text")
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
            candidate.get("name_confidence") or candidate.get("confidence"), 0.5
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
            "avg_price_hint": _string_or_none(card.get("avg_price_hint"))
            or _string_or_none(card.get("price")),
            "cover_source": _string_or_none(card.get("cover_source")),
            "tags": [],
            "recommended_dishes": _conclusion_items(card.get("recommended_dishes"), "name"),
            "avoid_points": _conclusion_items(card.get("avoid_points"), "text"),
            "suitable_scenes": _string_list(card.get("suitable_scenes"), 5),
        },
        "review_dimensions": _normalize_review_dimensions(candidate.get("review_dimensions")),
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
        or _string_or_none(raw_video.get("summary"))
        or metadata.title,
        "primary_city": _string_or_none(raw_video.get("primary_city")),
        "primary_categories": _string_list(raw_video.get("primary_categories"), 5),
        "analysis_confidence": _confidence_value(
            raw_video.get("analysis_confidence") or raw_video.get("confidence"), 0.5
        ),
        "risk_flags": _filtered_ai_risk_flags(raw_video.get("risk_flags")),
        "evidence_ids": _string_list(raw_video.get("evidence_ids")),
    }
    candidates = parsed.get("shop_candidates")
    normalized["shop_candidates"] = [
        _normalize_shop_candidate(candidate, index, request)
        for index, candidate in enumerate(candidates if isinstance(candidates, list) else [])
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
) -> tuple[str, dict[str, Any]]:
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


async def _repair_json(
    stage: str, raw_output_text: str, error_message: str
) -> tuple[str, dict[str, Any]]:
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


async def _focused_transcript_insights(
    request: VideoAnalysisRequest,
) -> tuple[dict[str, Any], dict[str, Any]]:
    segments = _representative_items(
        [segment.model_dump(mode="json") for segment in request.transcript_segments], 240
    )
    raw_text, usage = await _chat_completion(
        [
            {
                "role": "system",
                "content": (
                    "你只分析探店视频字幕中的博主评价。不得使用标题或评论替代字幕结论。"
                    "只输出 JSON，不要 Markdown。每道菜和结论必须引用输入 segment_id。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": (
                            "按完整时间顺序判断博主是否推荐，提取推荐菜、不推荐或仅建议猎奇的菜，"
                            "并用味道、口感、价格等字幕原话概括原因。"
                        ),
                        "output_schema": {
                            "attitude": "recommend|conditional|not_recommend|unclear",
                            "recommend_reason": "100字内，必须包含态度、菜品和具体原因",
                            "recommended_dishes": [
                                {
                                    "name": "菜名",
                                    "reason": "具体原因",
                                    "confidence": 0.0,
                                    "evidence_ids": ["segment_id"],
                                }
                            ],
                            "avoid_points": [
                                {
                                    "text": "不推荐或限制条件",
                                    "confidence": 0.0,
                                    "evidence_ids": ["segment_id"],
                                }
                            ],
                            "category": {
                                "primary": list(PRIMARY_SHOP_CATEGORIES),
                                "secondary": list(SECONDARY_CUISINES),
                                "confidence": 0.0,
                            },
                        },
                        "transcript_segments": segments,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
    )
    parsed = _parse_json_output(raw_text)
    reason = _string_or_none(parsed.get("recommend_reason"))
    return (
        {
            "attitude": parsed.get("attitude")
            if parsed.get("attitude") in {"recommend", "conditional", "not_recommend", "unclear"}
            else "unclear",
            "recommend_reason": "" if _is_vague_review_text(reason) else reason or "",
            "recommended_dishes": _conclusion_items(parsed.get("recommended_dishes"), "name"),
            "avoid_points": _conclusion_items(parsed.get("avoid_points"), "text"),
            "category": _normalized_category(parsed.get("category"), request),
        },
        usage,
    )


async def _focused_comment_dimensions(
    request: VideoAnalysisRequest,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    comments = [comment.model_dump(mode="json") for comment in request.comment_samples]
    raw_text, usage = await _chat_completion(
        [
            {
                "role": "system",
                "content": (
                    "你只聚合视频评论中的实际用餐评价。评论无需包含店名。"
                    "不得把猎奇讨论或提问当成到店评价。只输出 JSON，不要 Markdown。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": (
                            "提取评论明确表达的菜品推荐、口味、性价比、服务、环境和排队评价。"
                            "同一维度综合正负面，summary 写具体菜品与观点，并引用 comment_id。"
                        ),
                        "allowed_dimensions": [
                            "taste",
                            "dish_recommendation",
                            "value_for_money",
                            "service",
                            "environment",
                            "queue",
                        ],
                        "output_schema": {
                            "aspect_sentiments": {
                                "dimension": {
                                    "sentiment": "positive|neutral|negative|mixed|controversial",
                                    "summary": "具体评论结论",
                                    "confidence": 0.0,
                                    "evidence_ids": ["comment_id"],
                                }
                            }
                        },
                        "comment_samples": comments,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
    )
    parsed = _parse_json_output(raw_text)
    dimensions = _normalize_review_dimensions(parsed.get("aspect_sentiments"))
    allowed = {
        "taste",
        "dish_recommendation",
        "value_for_money",
        "service",
        "environment",
        "queue",
    }
    return ({key: value for key, value in dimensions.items() if key in allowed}, usage)


async def _minimax_structured_call(
    stage: Literal["classify_video", "comment_signal", "structure_video"],
    request: VideoAnalysisRequest,
    response_model: type[T],
) -> AiResponseEnvelope:
    prompt_versions = {
        "classify_video": "classify_video.v1.minimax",
        "comment_signal": "comment_signal.v2.minimax",
        "structure_video": "structure_video.v2.minimax",
    }
    prompt_version = prompt_versions[stage]
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
            raise HTTPException(
                status_code=502, detail=f"minimax_schema_error: {repair_error}"
            ) from repair_error

    output = validated.model_dump(mode="json")
    if stage == "structure_video":
        candidates = output.get("shop_candidates")
        if isinstance(candidates, list):
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                card = candidate.get("card_payload")
                if not isinstance(card, dict):
                    continue
                for field in ("recommended_dishes", "avoid_points"):
                    items = card.get(field)
                    if not isinstance(items, list):
                        continue
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        for optional_field in ("name", "text", "reason"):
                            if item.get(optional_field) is None:
                                item.pop(optional_field, None)

    return AiResponseEnvelope(
        output=output,
        provider=MINIMAX_PROVIDER,
        model=_minimax_model(),
        prompt_version=prompt_version,
        usage=usage,
        raw_output_text=raw_output_text,
    )


@app.post("/ai/classify-video", response_model=AiResponseEnvelope)
async def classify_video(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    return await _minimax_structured_call("classify_video", request, VideoClassificationResponse)


@app.post("/ai/comment-signals", response_model=AiResponseEnvelope)
async def comment_signals(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    envelope = await _minimax_structured_call("comment_signal", request, CommentSignalResponse)
    if envelope.output.get("aspect_sentiments") or not request.comment_samples:
        return envelope

    dimensions, focused_usage = await _focused_comment_dimensions(request)
    if not dimensions:
        return envelope
    output = dict(envelope.output)
    output["aspect_sentiments"] = dimensions
    output["risk_flags"] = [
        flag for flag in output.get("risk_flags", []) if flag != "insufficient_evidence"
    ]
    validated = CommentSignalResponse.model_validate(output)
    return envelope.model_copy(
        update={
            "output": validated.model_dump(mode="json"),
            "usage": {**envelope.usage, "focused_comment_analysis": focused_usage},
        }
    )


@app.post("/ai/structure-video", response_model=AiResponseEnvelope)
async def structure_video(request: VideoAnalysisRequest) -> AiResponseEnvelope:
    insights: dict[str, Any] = {}
    insight_usage: dict[str, Any] = {}
    if request.transcript_segments:
        insights, insight_usage = await _focused_transcript_insights(request)
    previous_outputs = {**request.previous_stage_outputs, "transcriptInsights": insights}
    enriched_request = request.model_copy(update={"previous_stage_outputs": previous_outputs})
    envelope = await _minimax_structured_call(
        "structure_video", enriched_request, VideoStructuredAnalysisResponse
    )
    return envelope.model_copy(
        update={"usage": {**envelope.usage, "transcript_insights": insight_usage}}
    )
