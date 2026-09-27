"""Fetch Eastmoney valuations, CSI dividend yield and ChinaBond yield independently."""
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

VALUATION_URL = ('https://fundztapi.eastmoney.com/FundSpecialApiNew/FundSpecialZSB30ZSIndex'
                 '?IndexCode=H30269&Version=6.5.5&deviceid=-&pageIndex=1&pageSize=10000&plat=Iphone&product=EFund')
DIVIDEND_URL = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls'
BOND_URL = 'https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/showCbrc'
OUTPUT = Path(__file__).resolve().parent.parent / 'public' / 'data'


def valid_point(day, value):
    parsed = date.fromisoformat(day)
    today = datetime.now(timezone(timedelta(hours=8))).date()
    if parsed > today or not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError('Invalid yield date/value')
    return {'date': day, 'value': value}


def parse_valuation(payload):
    data = payload.get('Datas')
    if payload.get('Success') is not True or payload.get('ErrCode') != 0 or not isinstance(data, dict):
        raise ValueError('Eastmoney valuation request unsuccessful')
    if data.get('IndexCode') != 'H30269':
        raise ValueError('Unexpected index code')
    day = data.get('PDate', '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
        raise ValueError('Missing valuation date')
    valid_point(day, 0)
    values = {}
    for target, field in [('pe', 'Petim'), ('pb', 'PB')]:
        raw = data.get(field)
        if isinstance(raw, bool) or raw is None:
            raise ValueError(f'Invalid {field}')
        value = float(raw)
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f'Invalid {field}')
        values[target] = value
    return {'code': 'H30269', 'provider': 'Eastmoney', 'source': VALUATION_URL,
            'basis': 'provider_unspecified', 'unit': 'multiple', 'date': day,
            **values, 'dividendYield': None}


def fetch_valuation():
    # HTTP 200 can still contain a temporary upstream failure. Retry parsing too.
    for attempt in range(3):
        try:
            return parse_valuation(json.loads(download(VALUATION_URL)))
        except (ValueError, TypeError):
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


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
            with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com/'}), timeout=20) as response:
                content = response.read(5_000_001)
                if len(content) > 5_000_000:
                    raise ValueError('Upstream response too large')
                return content
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def save_point(path, point, code, source, basis):
    valid_point(point['date'], point['value'])
    payload = {'code': code, 'source': source, 'basis': basis, 'unit': 'percent', **point}
    return save_payload(path, payload)


def save_payload(path, payload):
    if path.exists():
        old = json.loads(path.read_text(encoding='utf-8'))
        if any(old.get(key) != payload.get(key) for key in ('code', 'unit', 'source', 'basis')):
            raise ValueError('Existing indicator metadata invalid')
        if old['date'] > payload['date']:
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
    return parse_dividend_rows(fetch_csi_rows())


def fetch_csi_rows():
    import xlrd
    sheet = xlrd.open_workbook(file_contents=download(DIVIDEND_URL)).sheet_by_index(0)
    return [sheet.row_values(i) for i in range(sheet.nrows)]


CSI_METADATA = {'schemaVersion': 1, 'code': 'H30269', 'provider': 'CSI',
                'source': DIVIDEND_URL, 'basis': 'dual_share_capital',
                'unit': 'pe_multiple_dividend_percent', 'collection': 'rolling_file_accumulation'}
CSI_FIELDS = {'peTotal': 'P/E1', 'peCalculation': 'P/E2',
              'dividendTotal': 'D/P1', 'dividendCalculation': 'D/P2'}


def validate_csi_point(record):
    day = record.get('date', '')
    if not isinstance(day, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
        raise ValueError('Invalid CSI history date')
    valid_point(day, 0)
    for key in CSI_FIELDS:
        value = record.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f'Invalid CSI {key}')
        if (key.startswith('pe') and value <= 0) or (key.startswith('dividend') and not 0 <= value <= 100):
            raise ValueError(f'Invalid CSI {key}')
    return {key: record[key] for key in ('date', *CSI_FIELDS)}


def parse_csi_valuation_rows(rows):
    if len(rows) < 2:
        raise ValueError('Empty CSI valuation file')
    header, *records = rows
    columns = {}
    for key, field in {**CSI_FIELDS, 'code': 'Index Code', 'date': 'Date'}.items():
        matches = [i for i, name in enumerate(header) if field in str(name)]
        if len(matches) != 1:
            raise ValueError(f'CSI column missing or ambiguous: {field}')
        columns[key] = matches[0]
    points = {}
    for row in records:
        if len(row) <= max(columns.values()) or str(row[columns['code']]).strip() != 'H30269':
            raise ValueError('Unexpected CSI index/row')
        raw = str(row[columns['date']]).strip()
        if not re.fullmatch(r'\d{8}', raw):
            raise ValueError('Invalid CSI source date')
        point = {'date': f'{raw[:4]}-{raw[4:6]}-{raw[6:]}'}
        for key in CSI_FIELDS:
            value = row[columns[key]]
            if isinstance(value, bool):
                raise ValueError('Invalid CSI boolean')
            point[key] = float(value)
        point = validate_csi_point(point)
        if point['date'] in points:
            raise ValueError('Duplicate CSI source date')
        points[point['date']] = point
    return sorted(points.values(), key=lambda point: point['date'])


def save_csi_valuation_history(path, points):
    if not points:
        raise ValueError('Empty CSI valuation update')
    incoming = [validate_csi_point(point) for point in points]
    if len({p['date'] for p in incoming}) != len(incoming):
        raise ValueError('Duplicate CSI update date')
    records = {}
    if path.exists():
        old = json.loads(path.read_text(encoding='utf-8'))
        if any(old.get(key) != value for key, value in CSI_METADATA.items()):
            raise ValueError('CSI history metadata mismatch')
        if not isinstance(old.get('history'), list) or not old['history']:
            raise ValueError('Invalid CSI history')
        previous = ''
        for point in old['history']:
            point = validate_csi_point(point)
            if point['date'] <= previous:
                raise ValueError('Unsorted/duplicate CSI history')
            previous = point['date']
            records[previous] = point
        if previous != old.get('date') or max(p['date'] for p in incoming) < previous:
            raise ValueError('CSI upstream date regressed')
    # Merge all returned observations, including revisions, retaining older dates.
    records.update({p['date']: p for p in incoming})
    history = sorted(records.values(), key=lambda p: p['date'])
    return save_payload(path, {**CSI_METADATA, 'date': history[-1]['date'], 'history': history})


def update_csi_valuation(rows=None):
    status_path = OUTPUT / 'valuation-csi-status-h30269.json'
    old = json.loads(status_path.read_text(encoding='utf-8')) if status_path.exists() else {}
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    status = {'code': 'H30269', 'provider': 'CSI', 'source': DIVIDEND_URL,
              'lastAttemptAt': now, 'lastSuccessAt': old.get('lastSuccessAt')}
    error = None
    try:
        points = parse_csi_valuation_rows(rows if rows is not None else fetch_csi_rows())
        save_csi_valuation_history(OUTPUT / 'valuation-history-csi-h30269.json', points)
        status.update(status='ok', lastSuccessAt=now, error=None)
    except Exception as cause:
        error = cause
        status.update(status='error', error='中证估值更新失败，保留上次数据')
    # Status is separate: failed attempts must never alter historical observations.
    status_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=status_path.parent, delete=False) as stream:
            temporary = stream.name
            json.dump(status, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')
        os.replace(temporary, status_path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    if error:
        raise error


def save_valuation_history(path, snapshots):
    """Merge only verified snapshots of this exact provider/basis; never infer history."""
    metadata = {'schemaVersion': 1, 'code': 'H30269', 'provider': 'Eastmoney',
                'source': VALUATION_URL, 'basis': 'provider_unspecified', 'unit': 'multiple',
                'collection': 'daily_snapshots'}
    old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    if old and any(old.get(key) != value for key, value in metadata.items()):
        raise ValueError('Historical valuation metadata mismatch')

    def point(record):
        day = record.get('date', '')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
            raise ValueError('Invalid historical valuation date')
        valid_point(day, 0)
        if any(isinstance(record.get(key), bool) or not isinstance(record.get(key), (float, int))
               or not math.isfinite(record[key]) or record[key] <= 0 for key in ('pe', 'pb')):
            raise ValueError('Invalid historical valuation value')
        return {key: record[key] for key in ('date', 'pe', 'pb')}

    records = {}
    previous = ''
    if old:
        if not isinstance(old.get('history'), list) or not old['history']:
            raise ValueError('Empty historical valuation file')
        for row in old['history']:
            row = point(row)
            if row['date'] <= previous:
                raise ValueError('Unsorted/duplicate historical valuation date')
            previous = row['date']
            records[previous] = row
        if old.get('date') != previous:
            raise ValueError('Historical valuation end date mismatch')
    for snapshot in snapshots:
        if any(snapshot.get(key) != metadata[key] for key in ('code', 'provider', 'source', 'basis', 'unit')):
            raise ValueError('Snapshot valuation metadata mismatch')
        row = point(snapshot)
        records[row['date']] = row
    if not records:
        raise ValueError('No historical valuation observations')
    history = sorted(records.values(), key=lambda row: row['date'])
    return save_payload(path, {**metadata, 'date': history[-1]['date'], 'history': history})


def main():
    failed = False
    sources = {}
    try:
        valuation = fetch_valuation()
        changed = save_payload(OUTPUT / 'valuation-h30269.json', valuation)
        save_valuation_history(OUTPUT / 'valuation-history-h30269.json', [valuation])
        sources['valuation'] = None
        print(f'H30269: {valuation["date"]} PE={valuation["pe"]} PB={valuation["pb"]} ({"updated" if changed else "unchanged"})')
    except Exception as error:
        failed = True
        sources['valuation'] = '估值更新失败'
        print(f'H30269 valuation: failed, existing file preserved: {error}', file=sys.stderr)
    # Share a single CSI download between dividend and historical PE parsing.
    csi_rows = None
    try:
        csi_rows = fetch_csi_rows()
    except Exception as error:
        print(f'CSI download failed: {error}', file=sys.stderr)
    try:
        update_csi_valuation(csi_rows if csi_rows is not None else [])
        sources['csiValuation'] = None
    except Exception as error:
        failed = True
        sources['csiValuation'] = '中证估值更新失败'
        print(f'CSI valuation: failed, existing history preserved: {error}', file=sys.stderr)
    for filename, code, source, basis, fetcher in [
        ('dividend-h30269.json', 'H30269', DIVIDEND_URL, 'total_share_capital',
         lambda: parse_dividend_rows(csi_rows if csi_rows is not None else [])),
        ('china-bond-10y.json', 'CN10Y', BOND_URL, 'government_bond_yield_curve_10y',
         lambda: parse_bond(download(BOND_URL).decode('utf-8'))),
    ]:
        try:
            point = fetcher()
            changed = save_point(OUTPUT / filename, point, code, source, basis)
            sources['dividend' if code == 'H30269' else 'bond'] = None
            print(f'{code}: {point["date"]} {point["value"]}% ({"updated" if changed else "unchanged"})')
        except Exception as error:
            failed = True
            sources['dividend' if code == 'H30269' else 'bond'] = '股息率更新失败' if code == 'H30269' else '国债收益率更新失败'
            print(f'{code}: failed, existing file preserved: {error}', file=sys.stderr)
    report = os.environ.get('METRICS_UPDATE_REPORT')
    if report:
        Path(report).write_text(json.dumps({'sources': sources}, ensure_ascii=False), encoding='utf-8')
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
