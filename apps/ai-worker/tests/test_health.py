from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

import app.main as main
from app.main import (
    _extract_groq_segments,
    _extract_json_text,
    _normalize_review_dimensions,
    _normalize_structured_payload,
    app,
)
from app.prompts import PROMPTS, build_messages
from app.schemas import CommentSignalResponse, VideoAnalysisRequest, VideoClassificationResponse


def _analysis_payload() -> dict:
    return {
        "video_metadata": {
            "video_id": "video-1",
            "bvid": "BV1",
            "creator_id": "creator-1",
            "title": "上海牛肉面探店",
            "description": "一家面馆",
            "tags": ["探店"],
            "category": "美食",
        },
        "transcript_segments": [
            {"segment_id": "ev-1", "start_sec": 0, "end_sec": 3, "text": "这家牛肉面分量足。"}
        ],
        "comment_samples": [],
    }


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_legacy_ai_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        CommentSignalResponse.model_validate(
            {
                "video_id": "video-1",
                "shop_name_mentions": [
                    {
                        "name": "旧店名字段",
                        "confidence": 0.9,
                        "evidence_ids": ["comment-1"],
                    }
                ],
            }
        )
def test_asr_requires_file() -> None:
    client = TestClient(app)
    response = client.post("/asr/transcribe")
    assert response.status_code == 400
    assert response.json()["detail"] == "audio_file_required"


def test_groq_avg_logprob_maps_to_confidence() -> None:
    segments = _extract_groq_segments(
        {"segments": [{"start": 0, "end": 1.2, "text": "hello", "avg_logprob": -0.620}]}
    )

    assert segments[0]["confidence"] is not None
    assert 0 <= segments[0]["confidence"] <= 1
    assert round(segments[0]["confidence"], 3) == 0.538


def test_groq_missing_avg_logprob_keeps_confidence_null() -> None:
    segments = _extract_groq_segments({"segments": [{"start": 0, "end": 1.2, "text": "hello"}]})

    assert segments[0]["confidence"] is None


def test_extract_json_text_removes_fence_and_thinking() -> None:
    raw = '<think>hidden</think>\n```json\n{"ok": true}\n```'

    assert _extract_json_text(raw) == '{"ok": true}'


def test_structure_normalization_does_not_invent_missing_candidates() -> None:
    request = VideoAnalysisRequest.model_validate(
        {
            **_analysis_payload(),
            "previous_stage_outputs": {
                "classification": {"is_shop_visit": True, "content_type": "single_shop_visit"},
                "transcriptInsights": {
                    "candidate_name": "李氏疙瘩汤",
                    "name_confidence": 0.95,
                    "location_hints": {"city": "烟台", "confidence": 0.9},
                    "recommend_reason": "博主推荐疙瘩汤，认为汤鲜、配料足。",
                    "recommendation_score": 0.88,
                    "recommendation_score_evidence_ids": ["ev-1"],
                    "recommended_dishes": [
                        {
                            "name": "疙瘩汤",
                            "reason": "汤鲜、配料足",
                            "confidence": 0.9,
                            "evidence_ids": ["ev-1"],
                        }
                    ],
                    "avoid_points": [],
                    "category": {"primary": "地方特色菜", "secondary": "鲁菜", "confidence": 0.9},
                },
            },
        }
    )

    result = _normalize_structured_payload(
        {
            "video": {"is_shop_visit": True, "content_type": "single_shop_visit"},
            "shop_candidates": [],
        },
        request,
    )

    assert result["shop_candidates"] == []


def test_comment_summary_keeps_evidence_ids_out_of_visible_text() -> None:
    result = _normalize_review_dimensions(
        {
            "taste": {
                "sentiment": "positive",
                "summary": "疙瘩汤料足（e628e5f6、49ecf592-1218-4152-a81a-07f36bf593c8）。",
                "confidence": 0.9,
                "evidence_ids": ["49ecf592-1218-4152-a81a-07f36bf593c8"],
            }
        }
    )

    assert result["taste"]["summary"] == "疙瘩汤料足。"
    assert result["taste"]["evidence_ids"] == ["49ecf592-1218-4152-a81a-07f36bf593c8"]


def test_prompt_registry_is_complete_and_structured() -> None:
    assert set(PROMPTS) == {
        "classify_video",
        "comment_relevance_filter",
        "comment_analysis",
        "transcript_fact_extraction",
        "transcript_opinion_analysis",
        "structure_synthesis",
        "json_repair",
        "structure_semantic_retry",
    }
    assert len({spec.version for spec in PROMPTS.values()}) == len(PROMPTS)
    messages = build_messages("classify_video", {}, VideoClassificationResponse)
    system = str(messages[0]["content"])
    assert "# Objective" in system
    assert "# Evidence Policy" in system
    assert "# Decision Rules" in system
    assert "# Output Contract" in system


def test_structure_retries_when_single_shop_candidate_is_missing(monkeypatch) -> None:
    called_prompts: list[str] = []

    async def fake_chat_completion(messages, *, model):  # type: ignore[no-untyped-def]
        del model
        user_payload = __import__("json").loads(messages[1]["content"])
        key = user_payload["prompt_key"]
        called_prompts.append(key)
        if key == "transcript_fact_extraction":
            return (
                """{"candidate_name":"大笑饭堂","name_confidence":0.95,
                "name_evidence_ids":["ev-1"],"location_hints":{"country":"中国",
                "province":"广东","city":"佛山","district":"顺德","business_area":null,
                "address_text":null,"landmarks":[],"confidence":0.8},
                "category":{"primary":"中餐","secondary":"粤菜","confidence":0.9}}""",
                {},
            )
        if key == "transcript_opinion_analysis":
            return (
                """{"attitude":"recommend","recommend_reason":"博主推荐鱼饼，认为咸香Q弹。",
                "recommendation_score":0.9,"recommendation_score_evidence_ids":["ev-1"],
                "recommended_dishes":[{"name":"怀旧尖椒鱼饼","reason":"咸香Q弹",
                "confidence":0.9,"evidence_ids":["ev-1"]}],"avoid_points":[]}""",
                {},
            )
        video = (
            '"video":{"video_id":"video-1","bvid":"BV1","creator_id":"creator-1",'
            '"title":"大笑饭堂","content_type":"single_shop_visit","is_shop_visit":true,'
            '"overall_summary":"博主探访大笑饭堂。","primary_city":"佛山",'
            '"primary_categories":["中餐"],"analysis_confidence":0.9,'
            '"risk_flags":[],"evidence_ids":["ev-1"]}'
        )
        if key == "structure_synthesis":
            return (f'{{"schema_version":"video_structured_analysis.v1",{video},"shop_candidates":[]}}', {})
        return (
            f'{{"schema_version":"video_structured_analysis.v1",{video},'
            '"shop_candidates":[{"candidate_name":"大笑饭堂","candidate_type":"physical_shop",'
            '"card_payload":{"display_title":"大笑饭堂","recommend_reason":"博主推荐鱼饼，认为咸香Q弹。",'
            '"recommendation_score":0.9,"recommendation_score_evidence_ids":["ev-1"],'
            '"recommended_dishes":[{"name":"怀旧尖椒鱼饼","reason":"咸香Q弹",'
            '"confidence":0.9,"evidence_ids":["ev-1"]}]}}]}',
            {},
        )

    monkeypatch.setattr(main, "_chat_completion", fake_chat_completion)
    payload = _analysis_payload()
    payload["video_metadata"]["title"] = "顺德大笑饭堂"
    response = TestClient(app).post("/ai/structure-video", json=payload)

    assert response.status_code == 200
    assert response.json()["output"]["shop_candidates"][0]["candidate_name"] == "大笑饭堂"
    assert response.json()["output"]["shop_candidates"][0]["card_payload"][
        "recommendation_score"
    ] == 0.9
    assert called_prompts == [
        "transcript_fact_extraction",
        "transcript_opinion_analysis",
        "structure_synthesis",
        "structure_semantic_retry",
    ]


def test_comment_analysis_only_receives_filtered_comments(monkeypatch) -> None:
    analyzed_comment_ids: list[str] = []

    async def fake_chat_completion(messages, *, model):  # type: ignore[no-untyped-def]
        del model
        payload = __import__("json").loads(messages[1]["content"])
        if payload["prompt_key"] == "comment_relevance_filter":
            return ('{"relevant_comment_ids":["comment-current"]}', {})
        comments = payload["input"]["comment_samples"]
        analyzed_comment_ids.extend(item["comment_id"] for item in comments)
        return (
            """{"schema_version":"comment_signal.v1","video_id":"video-1",
            "sample_strategy":{},"location_questions":[],"shop_name_mentions":[],
            "address_mentions":[],"status_mentions":[],"aspect_sentiments":{
            "taste":{"sentiment":"positive","summary":"鱼饼咸香Q弹。",
            "confidence":0.9,"evidence_ids":["comment-current"]}},"risk_flags":[]}""",
            {},
        )

    monkeypatch.setattr(main, "_chat_completion", fake_chat_completion)
    payload = _analysis_payload()
    payload["previous_stage_outputs"] = {
        "classification": {"is_shop_visit": True, "content_type": "single_shop_visit"}
    }
    payload["comment_samples"] = [
        {"comment_id": "comment-current", "content": "这家鱼饼好吃"},
        {"comment_id": "comment-other", "content": "隔壁店更便宜"},
    ]
    response = TestClient(app).post("/ai/comment-signals", json=payload)

    assert response.status_code == 200
    assert analyzed_comment_ids == ["comment-current"]
    assert [call["stage"] for call in response.json()["subcalls"]] == [
        "comment_relevance_filter",
        "comment_analysis",
    ]


def test_minimax_classify_success(monkeypatch) -> None:
    called_models: list[str] = []

    async def fake_chat_completion(messages, *, model):  # type: ignore[no-untyped-def]
        called_models.append(model)
        return (
            """
            {
              "schema_version": "video_classification.v1",
              "video_id": "video-1",
              "bvid": "BV1",
              "is_shop_visit": true,
              "content_type": "single_shop_visit",
              "confidence": 0.86,
              "primary_city_hints": ["上海"],
              "primary_category_hints": ["restaurant"],
              "reason_codes": ["mentions_physical_shop"],
              "risk_flags": [],
              "need_manual_review": false,
              "evidence_ids": ["ev-1"]
            }
            """,
            {"total_tokens": 123},
        )

    monkeypatch.setattr(main, "_chat_completion", fake_chat_completion)
    client = TestClient(app)
    response = client.post("/ai/classify-video", json=_analysis_payload())

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "minimax"
    assert payload["model"] == "MiniMax-M2.7"
    assert payload["output"]["is_shop_visit"] is True
    assert payload["usage"]["calls"][0]["total_tokens"] == 123
    assert called_models == ["MiniMax-M2.7"]


def test_minimax_invalid_json_repairs_once(monkeypatch) -> None:
    calls = 0
    called_models: list[str] = []

    async def fake_chat_completion(messages, *, model):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        called_models.append(model)
        if calls == 1:
            return ("not-json", {"total_tokens": 1})
        return (
            """
            {
              "schema_version": "video_classification.v1",
              "video_id": "video-1",
              "video_id": "video-1",
              "bvid": "BV1",
              "is_shop_visit": false,
              "content_type": "non_shop_visit",
              "confidence": 0.9,
              "primary_city_hints": [],
              "primary_category_hints": [],
              "reason_codes": ["explicit_non_shop_context"],
              "risk_flags": [],
              "need_manual_review": false,
              "evidence_ids": []
            }
            """,
            {"total_tokens": 2},
        )

    monkeypatch.setattr(main, "_chat_completion", fake_chat_completion)
    client = TestClient(app)
    response = client.post("/ai/classify-video", json=_analysis_payload())

    assert response.status_code == 200
    assert response.json()["output"]["is_shop_visit"] is False
    assert calls == 2
    assert called_models == ["MiniMax-M2.7", "MiniMax-M2.7"]


def test_parse_json_output_repairs_unescaped_quotes_in_prose() -> None:
    parsed = main._parse_json_output(
        '{"recommend_reason":"标题以"不好找无环境但好吃"点明核心卖点。",'
        '"recommendation_score":0.88}'
    )

    assert parsed["recommend_reason"] == '标题以"不好找无环境但好吃"点明核心卖点。'
    assert parsed["recommendation_score"] == 0.88


def test_normalize_transcript_fact_payload_replaces_null_landmarks() -> None:
    parsed = main._normalize_transcript_fact_payload(
        {"location_hints": {"city": "乌鲁木齐", "landmarks": None}}
    )

    assert parsed == {"location_hints": {"city": "乌鲁木齐", "landmarks": []}}
