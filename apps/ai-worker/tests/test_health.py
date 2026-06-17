from fastapi.testclient import TestClient

from app.main import app


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
