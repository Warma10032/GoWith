from fastapi.testclient import TestClient

import app.main as main
from app.main import _extract_groq_segments, _extract_json_text, app


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


def test_asr_mock_response(monkeypatch) -> None:
    monkeypatch.setenv("EXTERNAL_MODE", "mock")
    client = TestClient(app)
    response = client.post(
        "/asr/transcribe",
        files={"file": ("sample.m4s", b"mock-audio", "audio/mp4")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "asr"
    assert payload["segments"]


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
    raw = "<think>hidden</think>\n```json\n{\"ok\": true}\n```"

    assert _extract_json_text(raw) == '{"ok": true}'


def test_minimax_classify_success(monkeypatch) -> None:
    async def fake_chat_completion(messages):  # type: ignore[no-untyped-def]
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

    monkeypatch.setenv("EXTERNAL_MODE", "real")
    monkeypatch.setattr(main, "_chat_completion", fake_chat_completion)
    client = TestClient(app)
    response = client.post("/ai/classify-video", json=_analysis_payload())

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "minimax"
    assert payload["output"]["is_shop_visit"] is True
    assert payload["usage"]["total_tokens"] == 123


def test_minimax_invalid_json_repairs_once(monkeypatch) -> None:
    calls = 0

    async def fake_chat_completion(messages):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        if calls == 1:
            return ("not-json", {"total_tokens": 1})
        return (
            """
            {
              "schema_version": "video_classification.v1",
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

    monkeypatch.setenv("EXTERNAL_MODE", "real")
    monkeypatch.setattr(main, "_chat_completion", fake_chat_completion)
    client = TestClient(app)
    response = client.post("/ai/classify-video", json=_analysis_payload())

    assert response.status_code == 200
    assert response.json()["output"]["is_shop_visit"] is False
    assert calls == 2
