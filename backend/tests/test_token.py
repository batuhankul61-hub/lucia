from app.scenarios import Level


def test_returns_token_locked_to_scenario(client, fake_gemini):
    res = client.post("/api/token", json={"scenario_id": "coffee-shop", "level": "A2"})

    assert res.status_code == 200
    body = res.json()
    assert body["token"] == "auth_tokens/fake-token"
    assert body["model"] == "gemini-3.8-live"
    assert body["max_session_minutes"] == 10
    assert fake_gemini.token_calls == [("coffee-shop", Level.A2, 10)]


def test_response_never_contains_api_key(client):
    res = client.post("/api/token", json={"scenario_id": "small-talk"})
    assert "test-key" not in res.text


def test_unknown_scenario_is_404(client):
    assert client.post("/api/token", json={"scenario_id": "space-station"}).status_code == 404


def test_invalid_level_is_422(client):
    assert client.post("/api/token", json={"scenario_id": "small-talk", "level": "Z9"}).status_code == 422


def test_upstream_failure_is_502(client, fake_gemini):
    fake_gemini.fail = True
    assert client.post("/api/token", json={"scenario_id": "small-talk"}).status_code == 502


def test_missing_api_key_is_503(client, settings):
    from app.deps import get_gemini
    from app.main import app

    app.dependency_overrides.pop(get_gemini)
    settings.gemini_api_key = ""
    assert client.post("/api/token", json={"scenario_id": "small-talk"}).status_code == 503


def test_access_code_required_when_configured(client, settings):
    settings.access_code = "secret"
    assert client.post("/api/token", json={"scenario_id": "small-talk"}).status_code == 401
    ok = client.post("/api/token", json={"scenario_id": "small-talk"}, headers={"X-Access-Code": "secret"})
    assert ok.status_code == 200


def test_rate_limit(client):
    statuses = [client.post("/api/token", json={"scenario_id": "small-talk"}).status_code for _ in range(11)]
    assert statuses[:10] == [200] * 10
    assert statuses[10] == 429


def test_cors_allows_only_configured_origin(client):
    allowed = client.options(
        "/api/token", headers={"Origin": "http://localhost:5500", "Access-Control-Request-Method": "POST"}
    )
    blocked = client.options(
        "/api/token", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5500"
    assert "access-control-allow-origin" not in blocked.headers


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}
