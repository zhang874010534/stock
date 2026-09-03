import asyncio
from contextlib import asynccontextmanager
import hmac
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .cache import HistoryCache
from .market import INSTRUMENTS, RANGES, fetch_history


async def load_history(symbol, range_key):
    return await asyncio.to_thread(fetch_history, symbol, range_key)


def create_app(*, loader=load_history, clock=None, token=None):
    options = {"clock": clock} if clock is not None else {}
    cache = HistoryCache(loader, **options)
    api_token = os.getenv("AKSHARE_API_TOKEN", "") if token is None else token

    @asynccontextmanager
    async def lifespan(_app):
        yield
        await cache.close()

    app = FastAPI(title="Stock AKShare API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health():
        # 健康检查不请求行情、不重置缓存或来源冷却。
        return {"status": "ok", "provider": "AKShare"}

    @app.get("/api/history")
    @app.get("/api/h30269")
    async def history(request: Request):
        if api_token and not hmac.compare_digest(request.headers.get("Authorization", ""), f"Bearer {api_token}"):
            return JSONResponse({"status": "error", "code": "unauthorized", "message": "服务认证失败"}, status_code=401, headers={"Cache-Control": "no-store"})
        symbol = "H30269" if request.url.path == "/api/h30269" else request.query_params.get("symbol", "H30269").upper()
        range_key = request.query_params.get("range", "1y")
        if symbol not in INSTRUMENTS or range_key not in RANGES:
            return JSONResponse({"status": "error", "code": "invalid_query", "message": "不支持的证券代码或时间范围"}, status_code=400)
        entry = await cache.get((symbol, range_key))
        remaining = cache.remaining(entry)
        headers = {"Cache-Control": f"public, max-age={remaining}"} if entry.status == 200 else {"Cache-Control": "no-store", "Retry-After": str(max(1, remaining))}
        return JSONResponse(entry.body, status_code=entry.status, headers=headers)

    return app


app = create_app()
