import asyncio

from app.cache import HistoryCache
from app.market import MarketError


def test_concurrent_requests_share_fetch_and_expiry_is_not_extended_by_reads():
    async def scenario():
        now = [0]
        calls = []

        async def loader(*key):
            calls.append(key)
            await asyncio.sleep(0)
            return {"generation": len(calls)}

        cache = HistoryCache(loader, clock=lambda: now[0])
        results = await asyncio.gather(*[cache.get(("H30269", "1y")) for _ in range(10)])
        assert len(calls) == 1
        assert all(entry is results[0] for entry in results)
        now[0] = 40
        hit = await cache.get(("H30269", "1y"))
        assert cache.remaining(hit) == 20
        assert len(calls) == 1
        now[0] = 60
        fresh = await cache.get(("H30269", "1y"))
        assert fresh.body == {"generation": 2}

    asyncio.run(scenario())


def test_disconnect_does_not_cancel_shared_query_and_other_misses_are_bounded():
    async def scenario():
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def loader(*key):
            calls.append(key)
            entered.set()
            await release.wait()
            return {"ok": True}

        cache = HistoryCache(loader)
        first = asyncio.create_task(cache.get(("H30269", "1y")))
        await entered.wait()
        second = asyncio.create_task(cache.get(("H30269", "1y")))
        busy = await cache.get(("H30269", "5y"))
        assert busy.status == 503 and busy.body["code"] == "busy"
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        release.set()
        assert (await second).status == 200
        assert len(calls) == 1
        assert not cache.pending

    asyncio.run(scenario())


def test_rate_limit_cooldown_applies_to_other_ranges_but_keeps_existing_fresh_data():
    async def scenario():
        now = [0]
        calls = []

        async def loader(*key):
            calls.append(key)
            if len(calls) == 2:
                raise MarketError("稍后重试", "upstream_429", 120)
            return {"ok": True}

        cache = HistoryCache(loader, clock=lambda: now[0])
        fresh = await cache.get(("H30269", "1m"))
        blocked = await cache.get(("H30269", "1y"))
        assert blocked.status == 503 and cache.remaining(blocked) == 120
        assert await cache.get(("H30269", "5y")) is blocked
        assert await cache.get(("H30269", "1m")) is fresh
        assert len(calls) == 2
        now[0] = 120
        assert (await cache.get(("H30269", "5y"))).status == 200
        assert len(calls) == 3

    asyncio.run(scenario())


def test_cache_evicts_least_recently_used_entry():
    async def scenario():
        async def loader(*_key):
            return {"ok": True}

        cache = HistoryCache(loader, max_entries=2)
        await cache.get(("H30269", "1m"))
        await cache.get(("H30269", "1y"))
        await cache.get(("H30269", "1m"))
        await cache.get(("H30269", "5y"))
        assert list(cache.entries) == [("H30269", "1m"), ("H30269", "5y")]

    asyncio.run(scenario())
