from app.ratelimit import RateLimiter


def test_window_slides():
    limiter = RateLimiter(limit=2, window_seconds=60)
    assert limiter.check("ip", now=0)
    assert limiter.check("ip", now=1)
    assert not limiter.check("ip", now=2)
    assert limiter.check("ip", now=61)


def test_keys_are_independent():
    limiter = RateLimiter(limit=1)
    assert limiter.check("a", now=0)
    assert limiter.check("b", now=0)
    assert not limiter.check("a", now=0)
