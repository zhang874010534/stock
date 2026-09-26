"""Refresh the official CSI H30269 membership snapshot independently."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from datetime import date, datetime, timezone, timedelta

spec = importlib.util.spec_from_file_location('indicator_fetch', Path(__file__).with_name('fetch-indicators.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/cons/H30269cons.xls'
OUTPUT = Path(__file__).resolve().parent.parent / 'public/data/constituents-h30269.json'


def parse_rows(rows):
    if not rows or len(rows[0]) != 9:
        raise ValueError('Unexpected constituent columns')
    for i, title in [(0, 'Date'), (1, 'Index Code'), (4, 'Constituent Code'), (5, 'Constituent Name'), (8, 'Exchange(Eng)')]:
        if title not in str(rows[0][i]):
            raise ValueError('Constituent header changed')
    members, dates, codes = [], set(), set()
    for row in rows[1:]:
        if len(row) != 9 or str(row[1]).strip() != 'H30269':
            raise ValueError('Unexpected constituent index')
        raw = str(row[0]).strip()
        if not re.fullmatch(r'\d{8}', raw):
            raise ValueError('Invalid constituent date')
        day = date.fromisoformat(f'{raw[:4]}-{raw[4:6]}-{raw[6:]}')
        if day > datetime.now(timezone(timedelta(hours=8))).date():
            raise ValueError('Future constituent date')
        dates.add(day.isoformat())
        code, name = str(row[4]).strip(), str(row[5]).strip()
        exchange = {'Shanghai Stock Exchange': 'SSE', 'Shenzhen Stock Exchange': 'SZSE'}.get(str(row[8]).strip())
        if not re.fullmatch(r'\d{6}', code) or code in codes or not name or not exchange:
            raise ValueError('Invalid or duplicate constituent')
        codes.add(code)
        members.append({'code': code, 'name': name, 'exchange': exchange})
    if len(dates) != 1 or len(members) != 50:
        raise ValueError('Expected 50 members at a single source date')
    return {'schemaVersion': 1, 'code': 'H30269', 'source': SOURCE, 'date': dates.pop(),
            'count': len(members), 'members': sorted(members, key=lambda item: item['code']),
            'status': 'ok', 'reason': None}


def atomic_save(path, payload):
    text = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
    if path.exists() and json.loads(path.read_text(encoding='utf-8')) == payload:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
            temporary = stream.name
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def fetch_members():
    import xlrd
    sheet = xlrd.open_workbook(file_contents=shared.download(SOURCE)).sheet_by_index(0)
    return parse_rows([sheet.row_values(i) for i in range(sheet.nrows)])


def refresh(path=OUTPUT, fetcher=fetch_members):
    old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    if old and (old.get('schemaVersion') != 1 or old.get('code') != 'H30269' or old.get('source') != SOURCE):
        raise ValueError('Existing constituent metadata invalid')
    try:
        payload = fetcher()
        if old and old.get('date') and payload['date'] < old['date']:
            raise ValueError('Constituent date regressed')
        content = {k: v for k, v in (old or {}).items() if k not in ('updatedAt',)}
        payload['updatedAt'] = old['updatedAt'] if content == payload else datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        atomic_save(path, payload)
        print(f'H30269 constituents: {payload["date"]}, {payload["count"]} members')
        return 0
    except Exception as error:
        payload = {**old, 'status': 'stale', 'reason': '成分股更新失败，保留上次数据'} if old and old.get('members') else {
            'schemaVersion': 1, 'code': 'H30269', 'source': SOURCE, 'date': None,
            'count': 0, 'members': [], 'status': 'unavailable', 'reason': '暂时无法获取成分股', 'updatedAt': None}
        atomic_save(path, payload)
        print(f'Constituent update failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(refresh())
