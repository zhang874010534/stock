"""AKShare 日线查询。每次调用在独立进程中运行，超时可以真正终止。"""

import calendar
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import logging
import math
import multiprocessing

SHANGHAI = timezone(timedelta(hours=8))
RANGES = {"1m": 1, "3m": 3, "6m": 6, "1y": 12, "3y": 36, "5y": 60, "all": None}
INSTRUMENTS = {"H30269": {"name": "中证红利低波动指数", "start": date(2005, 12, 30)}}


class MarketError(Exception):
    def __init__(self, message, code="upstream_error", retry_seconds=60):
        super().__init__(message)
        self.code = code
        self.retry_seconds = retry_seconds


def date_bounds(symbol, range_key, now):
    instrument = INSTRUMENTS[symbol]
    end = now.astimezone(SHANGHAI).date()
    months = RANGES[range_key]
    if months is None:
        return instrument["start"], end
    year, month = divmod(end.year * 12 + end.month - 1 - months, 12)
    month += 1
    day = min(end.day, calendar.monthrange(year, month)[1])
    start = date(year, month, day) - timedelta(days=10)
    return max(start, instrument["start"]), end


def normalize_frame(frame, symbol, start, end):
    required = {"日期", "指数代码", "收盘"}
    if frame.empty or len(frame) > 20_000 or not required.issubset(frame.columns):
        raise MarketError("AKShare 未返回有效的日线数据", "invalid_data")
    points = {}
    for raw_date, code, raw_close in frame[["日期", "指数代码", "收盘"]].itertuples(index=False, name=None):
        try:
            trade_date = raw_date.date() if isinstance(raw_date, datetime) else date.fromisoformat(str(raw_date))
            close = float(raw_close)
        except (TypeError, ValueError, OverflowError) as exc:
            raise MarketError("AKShare 日线日期或点位异常", "invalid_data") from exc
        if str(code).upper() != symbol or not math.isfinite(close) or close <= 0:
            raise MarketError("AKShare 日线代码或点位异常", "invalid_data")
        if start <= trade_date <= end:
            points[trade_date.isoformat()] = {"date": trade_date.isoformat(), "close": close}
    if not points:
        raise MarketError("该区间暂无可用日线", "empty_data")
    return [points[key] for key in sorted(points)]


def retry_delay(value):
    try:
        if value and value.strip().isdigit():
            return max(1, int(value))
        if value:
            seconds = math.ceil((parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
            return max(1, seconds)
    except (ValueError, TypeError, OverflowError):
        pass
    return 300


def _query_child(connection, symbol, start, end):
    try:
        import akshare as ak
        import requests

        # 仅在本次子进程中补齐 AKShare 缺省的网络超时和 HTTP 错误检查。
        # 仍由 AKShare 调用、解析原始接口，不重试，也不修改上游访问权限。
        original_request = requests.sessions.Session.request

        def bounded_request(session, method, url, **kwargs):
            if kwargs.get("timeout") is None:
                kwargs["timeout"] = (5, 12)
            kwargs["allow_redirects"] = False
            response = original_request(session, method, url, **kwargs)
            response.raise_for_status()
            if 300 <= response.status_code < 400:
                raise MarketError("数据源返回了重定向，请稍后再试")
            return response

        requests.sessions.Session.request = bounded_request
        frame = ak.stock_zh_index_hist_csindex(
            symbol=symbol,
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
        )
        connection.send({"ok": True, "history": normalize_frame(frame, symbol, start, end)})
    except Exception as exc:
        response = getattr(exc, "response", None)
        status = response.status_code if response is not None else None
        error = exc if isinstance(exc, MarketError) else MarketError("AKShare 数据源暂时不可用，请稍后再试")
        if status == 403:
            error = MarketError("数据源暂时拒绝访问，请稍后再试", "upstream_403", 900)
        elif status == 429:
            error = MarketError("数据源请求受限，请稍后再试", "upstream_429", retry_delay(response.headers.get("Retry-After")))
        logging.warning("AKShare query failed: %s (HTTP %s)", type(exc).__name__, status)
        connection.send({"ok": False, "message": str(error), "code": error.code, "retry_seconds": error.retry_seconds})
    finally:
        connection.close()


def run_isolated(symbol, start, end, *, timeout=25, target=_query_child):
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=target, args=(sender, symbol, start, end), daemon=True)
    process.start()
    sender.close()
    try:
        # 先接收再 join，避免大历史区间写满 Pipe 后双方互相等待。
        if not receiver.poll(timeout):
            raise MarketError("AKShare 行情请求超时，请稍后再试", "upstream_timeout")
        packet = receiver.recv()
        if not packet["ok"]:
            raise MarketError(packet["message"], packet["code"], packet["retry_seconds"])
        return packet["history"]
    except EOFError as exc:
        raise MarketError("AKShare 查询进程异常，请稍后再试") from exc
    finally:
        receiver.close()
        process.join(timeout=0.2)
        if process.is_alive():
            process.terminate()
            process.join(timeout=2)
        if process.is_alive():
            process.kill()
            process.join()
        process.close()


def fetch_history(symbol, range_key):
    start, end = date_bounds(symbol, range_key, datetime.now(timezone.utc))
    history = run_isolated(symbol, start, end)
    return {
        "status": "ok", "code": symbol, "name": INSTRUMENTS[symbol]["name"],
        "provider": "AKShare", "source": "中证指数", "interval": "1d", "range": range_key,
        "history": history, "latest": history[-1],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
