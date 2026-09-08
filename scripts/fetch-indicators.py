"""Fetch official index dividend and ChinaBond 10Y yields independently."""
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from datetime import date, datetime, timezone, timedelta
from html.parser import HTMLParser
from urllib.request import Request, urlopen

DIVIDEND_URL = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls'
BOND_URL = 'https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/showCbrc'
OUTPUT = Path(__file__).resolve().parent.parent / 'public' / 'data'


def valid_point(day, value):
    parsed = date.fromisoformat(day)
    today = datetime.now(timezone(timedelta(hours=8))).date()
    if parsed > today or not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError('Invalid yield date/value')
    return {'date': day, 'value': value}


def parse_dividend_rows(rows):
    header, *records = rows
    column = next((i for i, text in enumerate(header) if 'D/P1' in str(text)), None)
    if column is None or 'Index Code' not in str(header[1]):
        raise ValueError('CSI dividend column layout changed')
    points = []
    for row in records:
        if len(row) <= column or str(row[1]).strip() != 'H30269':
            raise ValueError('Unexpected index code/row')
        raw = str(row[0]).strip()
        if not re.fullmatch(r'\d{8}', raw):
            raise ValueError('Invalid CSI date')
        points.append(valid_point(f'{raw[:4]}-{raw[4:6]}-{raw[6:]}', float(row[column])))
    if not points:
        raise ValueError('Empty CSI dividend data')
    return max(points, key=lambda point: point['date'])


class YieldTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []

    def handle_data(self, text):
        if self.cell is not None:
            self.cell.append(text)

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def parse_bond(html):
    table = YieldTable()
    table.feed(html)
    header = None
    for row in table.rows:
        if row and re.fullmatch(r'\d{4}-\d{2}-\d{2}\(%\)', row[0]):
            header = row
        if row and row[0] in ('中债国债收益率曲线', 'ChinaBond Government Bond Yield Curve'):
            if not header or '10年' not in header or len(row) != len(header):
                raise ValueError('ChinaBond maturity columns changed')
            return valid_point(header[0][:10], float(row[header.index('10年')]))
    raise ValueError('ChinaBond government yield row missing')


def download(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'stock-dashboard/1.0'}), timeout=20) as response:
                content = response.read(5_000_001)
                if len(content) > 5_000_000:
                    raise ValueError('Upstream response too large')
                return content
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def save_point(path, point, code, source, basis):
    payload = {'code': code, 'source': source, 'basis': basis, 'unit': 'percent', **point}
    if path.exists():
        old = json.loads(path.read_text(encoding='utf-8'))
        if old.get('code') != code or old.get('unit') != 'percent':
            raise ValueError('Existing indicator metadata invalid')
        valid_point(old['date'], old['value'])
        if old['date'] > point['date']:
            raise ValueError('Upstream date regressed; keeping existing data')
        if all(old.get(key) == value for key, value in payload.items()):
            return False
    payload['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
            temporary = stream.name
            json.dump(payload, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return True


def fetch_dividend():
    import xlrd
    sheet = xlrd.open_workbook(file_contents=download(DIVIDEND_URL)).sheet_by_index(0)
    return parse_dividend_rows([sheet.row_values(i) for i in range(sheet.nrows)])


def main():
    failed = False
    for filename, code, source, basis, fetcher in [
        ('dividend-h30269.json', 'H30269', DIVIDEND_URL, 'total_share_capital', fetch_dividend),
        ('china-bond-10y.json', 'CN10Y', BOND_URL, 'government_bond_yield_curve_10y',
         lambda: parse_bond(download(BOND_URL).decode('utf-8'))),
    ]:
        try:
            point = fetcher()
            changed = save_point(OUTPUT / filename, point, code, source, basis)
            print(f'{code}: {point["date"]} {point["value"]}% ({"updated" if changed else "unchanged"})')
        except Exception as error:
            failed = True
            print(f'{code}: failed, existing file preserved: {error}', file=sys.stderr)
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
