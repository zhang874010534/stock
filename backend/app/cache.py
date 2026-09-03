import asyncio
from collections import OrderedDict
from dataclasses import dataclass
import logging
import math
import time

from .market import MarketError


@dataclass
class Entry:
    body: dict
    expires_at: float
    status: int = 200


class HistoryCache:
    """单个服务进程内的有界短缓存；没有文件、数据库或后台轮询。"""

    def __init__(self, loader, *, clock=time.monotonic, ttl=60, max_entries=32, max_pending=1):
        self.loader = loader
        self.clock = clock
        self.ttl = ttl
        self.max_entries = max_entries
        self.max_pending = max_pending
        self.entries = OrderedDict()
        self.pending = {}
        self.cooldown = None

    def remaining(self, entry):
        return max(0, math.floor(entry.expires_at - self.clock()))

    async def get(self, key):
        for expired in [key for key, entry in self.entries.items() if entry.expires_at <= self.clock()]:
            del self.entries[expired]
        if key in self.entries:
            self.entries.move_to_end(key)
            return self.entries[key]
        if self.cooldown and self.cooldown.expires_at > self.clock():
            return self.cooldown
        if key not in self.pending:
            if len(self.pending) >= self.max_pending:
                return Entry({"status": "error", "code": "busy", "message": "正在获取其他行情，请稍后再试"}, self.clock() + 3, 503)
            self.pending[key] = asyncio.create_task(self._load(key))
        # 一个浏览器断开时，其他相同请求仍共享本次查询。
        return await asyncio.shield(self.pending[key])

    async def _load(self, key):
        try:
            body = await self.loader(*key)
            entry = Entry(body, self.clock() + self.ttl)
        except Exception as exc:
            error = exc if isinstance(exc, MarketError) else MarketError("行情暂时无法获取，请稍后再试")
            logging.warning("History load failed: %s", error.code)
            entry = Entry({"status": "error", "code": error.code, "message": str(error)}, self.clock() + error.retry_seconds, 503)
            self.cooldown = entry
        finally:
            self.pending.pop(key, None)
        self.entries[key] = entry
        while len(self.entries) > self.max_entries:
            self.entries.popitem(last=False)
        return entry

    async def close(self):
        await asyncio.gather(*self.pending.values(), return_exceptions=True)
