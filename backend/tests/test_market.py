from datetime import date, datetime, timezone
import multiprocessing
import time

import pandas as pd
import pytest

from app.market import MarketError, date_bounds, normalize_frame, retry_delay, run_isolated


def test_date_window_uses_shanghai_date_and_clamps_leap_month():
    start, end = date_bounds("H30269", "1m", datetime(2024, 3, 30, 17, tzinfo=timezone.utc))
    assert (start, end) == (date(2024, 2, 19), date(2024, 3, 31))
    assert date_bounds("H30269", "all", datetime(2026, 9, 3, tzinfo=timezone.utc))[0] == date(2005, 12, 30)


def test_close_is_sorted_deduplicated_and_filtered_to_requested_window():
    frame = pd.DataFrame({
        "日期": [date(2026, 9, 3), date(2026, 9, 2), date(2026, 9, 3), date(2026, 9, 4)],
        "指数代码": ["H30269"] * 4,
        "开盘": [1, 1, 1, 1],
        "收盘": [100, 99, 101, 102],
    })
    assert normalize_frame(frame, "H30269", date(2026, 9, 1), date(2026, 9, 3)) == [
        {"date": "2026-09-02", "close": 99.0}, {"date": "2026-09-03", "close": 101.0},
    ]


@pytest.mark.parametrize("row", [
    {"日期": "2026-09-03", "指数代码": "000001", "收盘": 100},
    {"日期": "2026-09-03", "指数代码": "H30269", "收盘": float("nan")},
    {"日期": "2026-09-03", "指数代码": "H30269", "收盘": float("inf")},
    {"日期": "2026-09-03", "指数代码": "H30269", "收盘": 0},
    {"日期": "2026-02-30", "指数代码": "H30269", "收盘": 100},
    {"日期": "2026-09-03", "指数代码": "H30269", "开盘": 100},
])
def test_invalid_source_data_is_not_displayed(row):
    with pytest.raises(MarketError):
        normalize_frame(pd.DataFrame([row]), "H30269", date(2026, 1, 1), date(2026, 9, 3))


def test_empty_frame_is_an_error():
    with pytest.raises(MarketError):
        normalize_frame(pd.DataFrame(), "H30269", date(2026, 1, 1), date(2026, 9, 3))


def sleeping_child(connection, *_args):
    time.sleep(30)
    connection.close()


def large_result_child(connection, *_args):
    connection.send({"ok": True, "history": [{"date": "2026-09-03", "close": 100}] * 10_000})
    connection.close()


def test_timeout_terminates_process_instead_of_leaving_a_background_fetch():
    before = {child.pid for child in multiprocessing.active_children()}
    started = time.monotonic()
    with pytest.raises(MarketError) as caught:
        run_isolated("H30269", date(2026, 9, 1), date(2026, 9, 3), timeout=0.1, target=sleeping_child)
    assert caught.value.code == "upstream_timeout"
    assert time.monotonic() - started < 5
    assert {child.pid for child in multiprocessing.active_children()} == before


def test_large_history_does_not_deadlock_the_process_pipe():
    rows = run_isolated("H30269", date(2026, 9, 1), date(2026, 9, 3), timeout=10, target=large_result_child)
    assert len(rows) == 10_000


def test_retry_after_accepts_seconds_and_rejects_invalid_values():
    assert retry_delay("120") == 120
    assert retry_delay("0") == 1
    assert retry_delay("invalid") == 300
    assert retry_delay(None) == 300
