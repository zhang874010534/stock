from fastapi.testclient import TestClient

from app.main import create_app
from app.market import MarketError


def test_auth_validation_and_health_do_not_trigger_market_queries():
    calls = []

    async def loader(*key):
        calls.append(key)
        return {"provider": "AKShare", "history": [{"date": "2026-09-03", "close": 100}]}

    with TestClient(create_app(loader=loader, token="test-token")) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/history").status_code == 401
        client.headers["Authorization"] = "Bearer test-token"
        assert client.get("/api/history?symbol=000001").status_code == 400
        assert client.get("/api/history?range=invalid").status_code == 400
        assert calls == []
        response = client.get("/api/history?symbol=h30269&range=1m")
        assert response.status_code == 200
        assert response.json()["provider"] == "AKShare"
        assert calls == [("H30269", "1m")]
        assert client.get("/api/h30269?range=1m&timestamp=123&force=true").json() == response.json()
        assert len(calls) == 1


def test_remaining_cache_age_and_failures_have_correct_http_headers():
    now = [0]

    async def loader(_symbol, range_key):
        if range_key == "5y":
            raise MarketError("请求受限", "upstream_403", 900)
        return {"history": []}

    with TestClient(create_app(loader=loader, clock=lambda: now[0], token="")) as client:
        assert client.get("/api/history").headers["Cache-Control"] == "public, max-age=60"
        now[0] = 40
        assert client.get("/api/history").headers["Cache-Control"] == "public, max-age=20"
        failed = client.get("/api/history?range=5y")
        assert failed.status_code == 503
        assert failed.headers["Cache-Control"] == "no-store"
        assert failed.headers["Retry-After"] == "900"
        now[0] = 41
        assert client.get("/api/history?range=all").headers["Retry-After"] == "899"
