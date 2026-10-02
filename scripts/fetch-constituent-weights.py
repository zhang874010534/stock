"""Collect full CSI weights and the latest full ETF annual/interim disclosure."""
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import sys
from datetime import datetime, timezone, timedelta, date
from urllib.parse import urlencode
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('constituents', Path(__file__).with_name('fetch-constituents.py'))
constituents = importlib.util.module_from_spec(spec)
spec.loader.exec_module(constituents)
download = constituents.shared.download
WEIGHTS_SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/closeweight/H30269closeweight.xls'
DISCOVERY = 'https://www.sse.com.cn/disclosure/fund/announcement/'
ROOT = Path(__file__).resolve().parent.parent / 'public/data'


def sse_download(url):
    with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': DISCOVERY}), timeout=25) as response:
        raw = response.read(25 * 1024 * 1024 + 1)
    if len(raw) > 25 * 1024 * 1024:
        raise ValueError('SSE response exceeds size limit')
    return raw


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def number(value):
    result = float(str(value).replace(',', ''))
    if not math.isfinite(result):
        raise ValueError('Non-finite disclosure number')
    return result


def exchange(code):
    if re.fullmatch(r'6\d{5}', code):
        return 'SSE'
    if re.fullmatch(r'[03]\d{5}', code):
        return 'SZSE'
    raise ValueError('Unsupported stock exchange')


def validate(data):
    if data.get('schemaVersion') != 1 or data.get('status') not in ('ok', 'stale', 'unavailable') or not isinstance(data.get('members'), list):
        raise ValueError('Invalid snapshot envelope')
    constituents.valid_time(data['lastAttemptAt'])
    if (data['status'] == 'ok' and data.get('reason') is not None) or (data['status'] != 'ok' and not data.get('reason')):
        raise ValueError('Invalid snapshot reason')
    is_index = data['code'] == 'H30269'
    if is_index:
        if data.get('source') != WEIGHTS_SOURCE or data.get('scope') != 'full_index' or data.get('unit') != 'fraction':
            raise ValueError('Invalid index identity')
    elif data['code'] != '512890' or data.get('discoverySource') != DISCOVERY or data.get('scope') != 'full_equity' or data.get('unit') != 'CNY':
        raise ValueError('Invalid ETF identity')
    if data['status'] == 'unavailable':
        if data['members'] or data['date'] is not None or data['lastSuccessAt'] is not None or (not is_index and any(data.get(field) is not None for field in ('source', 'publishedDate', 'netAssets', 'equityValue'))):
            raise ValueError('Unavailable snapshot contains data')
        return data
    constituents.valid_day(data['date']); constituents.valid_time(data['lastSuccessAt'])
    if data['lastSuccessAt'] > data['lastAttemptAt'] or data['date'] > (datetime.fromisoformat(data['lastSuccessAt'].replace('Z', '+00:00')) + timedelta(hours=8)).date().isoformat():
        raise ValueError('Invalid snapshot chronology')
    seen = set()
    for row in data['members']:
        if row['exchange'] != exchange(row['code']) or row['code'] in seen or not isinstance(row['name'], str) or not row['name'].strip():
            raise ValueError('Invalid or duplicate member')
        seen.add(row['code'])
    if is_index:
        weights = [row['weight'] for row in data['members']]
        if len(weights) != 50 or any(isinstance(w, bool) or not isinstance(w, (int, float)) or not math.isfinite(w) or w <= 0 or w > 1 for w in weights) or abs(sum(weights) - 1) > .000251:
            raise ValueError('Incomplete index weights')
    else:
        constituents.valid_day(data['publishedDate'])
        success_day = (datetime.fromisoformat(data['lastSuccessAt'].replace('Z', '+00:00')) + timedelta(hours=8)).date().isoformat()
        if data['date'] > data['publishedDate'] or data['publishedDate'] > success_day or not re.fullmatch(r'https://www\.sse\.com\.cn/disclosure/fund/announcement/c/new/' + data['publishedDate'] + '/512890_' + data['publishedDate'].replace('-', '') + r'_[A-Z0-9]+\.pdf', data['source']):
            raise ValueError('Invalid ETF report provenance')
        nav, equity = data['netAssets'], data['equityValue']
        if not math.isfinite(nav) or nav <= 0 or nav > 1e14 or not math.isfinite(equity) or not 0 < equity <= nav * 1.1 or not 0 < len(data['members']) <= 1000:
            raise ValueError('Invalid ETF assets')
        for row in data['members']:
            if row['kind'] not in ('index', 'active') or type(row['shares']) is not int or row['shares'] <= 0 or not math.isfinite(row['marketValue']) or row['marketValue'] <= 0 or not math.isfinite(row['reportedWeight']) or row['reportedWeight'] < 0 or abs(row['reportedWeight'] - row['marketValue'] / nav) > .00005001:
                raise ValueError('ETF row does not reconcile with NAV')
        if abs(sum(row['marketValue'] for row in data['members']) - equity) > .02:
            raise ValueError('Full holdings do not reconcile with equity assets')
    return data


def parse_weights(rows):
    if len(rows[0]) != 10 or 'Date' not in str(rows[0][0]) or 'Index Code' not in str(rows[0][1]) or 'weight' not in str(rows[0][9]).lower():
        raise ValueError('CSI weight columns changed')
    members, dates = [], set()
    for row in rows[1:]:
        if not any(str(cell).strip() for cell in row):
            continue
        if len(row) != 10 or str(row[1]).strip() != 'H30269':
            raise ValueError('CSI weight identity changed')
        day = datetime.strptime(str(row[0]).strip(), '%Y%m%d').date().isoformat()
        constituents.valid_day(day); dates.add(day)
        code = str(row[4]).strip()
        expected = {'Shanghai Stock Exchange': 'SSE', 'Shenzhen Stock Exchange': 'SZSE'}.get(str(row[8]).strip())
        if expected != exchange(code):
            raise ValueError('CSI exchange mismatch')
        members.append({'code': code, 'name': str(row[5]).strip(), 'exchange': expected, 'weight': number(row[9]) / 100})
    if len(dates) != 1:
        raise ValueError('Mixed weight dates')
    return {'date': dates.pop(), 'members': sorted(members, key=lambda row: row['code'])}


def parse_report(text, source, published_date):
    # Remove repeated page furniture, then locate the full-holdings sections.
    text = re.sub(r'^.*华泰柏瑞中证红利低波动\s*ETF.*报告\s*$', '', text, flags=re.M)
    text = re.sub(r'^第\s*\d+页\s*共\s*\d+页\s*$', '', text, flags=re.M)
    if not re.search(r'基金主代码\s*512890\b', text) or '单位：人民币元' not in text or not re.search(r'(?:中期|年度)报告', text[:500]):
        raise ValueError('Wrong fund, currency or report type')
    date_match = re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', text[:500])
    if not date_match:
        raise ValueError('Missing report date')
    report_date = date(*map(int, date_match.groups())).isoformat()
    nav = re.search(r'净资产合计\s+([\d,]+\.\d{2})', text)
    equity = re.search(r'其中：股票投资\s+([\d,]+\.\d{2})', text)
    if not nav or not equity:
        raise ValueError('Missing net assets or equity total')
    heading = re.search(r'^([78])\.3\.1\s+期末指数投资[^\n]*所有股票投资明细', text, re.M)
    if not heading:
        raise ValueError('Full index holdings section missing (top-ten reports are unsupported)')
    section = heading[1]
    active = re.search(r'^' + section + r'\.3\.2\s+期末积极投资[^\n]*所有股票投资明细', text[heading.end():], re.M)
    end = re.search(r'^' + section + r'\.4\s', text[heading.end():], re.M)
    if not active or not end or active.start() >= end.start():
        raise ValueError('Full active holdings section missing')
    body = text[heading.end():]
    members = []
    row_pattern = r'^\s*(\d+)\s+(\d{6})\s+([^\d\n]+?)\s+([\d,]+)\s+([\d,]+\.\d{2})\s+(\d+\.\d{2})\s*$'
    for kind, block in [('index', body[:active.start()]), ('active', body[active.end():end.start()])]:
        records = list(re.finditer(row_pattern, block, re.M))
        candidates = list(re.finditer(r'^\s*\d+\s+\d{6}\s', block, re.M))
        if len(records) != len(candidates) or (not records and not (kind == 'active' and re.search(r'未持有|无积极投资', block))):
            raise ValueError('Unparsed holding rows')
        if [int(row[1]) for row in records] != list(range(1, len(records) + 1)):
            raise ValueError('Holdings ranks missing or duplicated')
        for row in records:
            members.append({'code': row[2], 'name': row[3].strip(), 'exchange': exchange(row[2]), 'kind': kind,
                            'shares': int(row[4].replace(',', '')), 'marketValue': number(row[5]), 'reportedWeight': number(row[6]) / 100})
    return {'source': source, 'publishedDate': published_date, 'date': report_date, 'netAssets': number(nav[1]), 'equityValue': number(equity[1]), 'members': members}


def fetch_weights():
    import xlrd
    sheet = xlrd.open_workbook(file_contents=download(WEIGHTS_SOURCE)).sheet_by_index(0)
    return parse_weights([sheet.row_values(i) for i in range(sheet.nrows)])


def discover_report(now=None, downloader=sse_download):
    end = now or datetime.now(timezone(timedelta(hours=8))).date()
    # SSE's search UI allows a maximum three-month interval. Search backwards
    # until a full interim/annual report appears; quarterly top-ten is excluded.
    for _ in range(5):
        start = end - timedelta(days=89)
        query = urlencode({'sqlId': 'COMMON_PL_JJXX_JJGG_NEW_L', 'SECURITY_CODE': '512890', 'START_DATE': start.isoformat(), 'END_DATE': end.isoformat(), 'pageHelp.pageSize': 100, 'isPagination': 'true'})
        data = json.loads(downloader('https://query.sse.com.cn/commonQuery.do?' + query))
        rows = data.get('result')
        if not isinstance(rows, list) or (data.get('pageHelp', {}).get('total') or 0) > 100:
            raise ValueError('Announcement search incomplete')
        reports = [row for row in rows if row.get('SECURITY_CODE') == '512890' and re.fullmatch(r'华泰柏瑞中证红利低波动交易型开放式指数证券投资基金\d{4}年(?:中期|年度)报告', row.get('TITLE', ''))]
        if reports:
            report = max(reports, key=lambda row: row['SSEDATE'])
            url = 'https://www.sse.com.cn' + report['URL']
            if not re.fullmatch(r'https://www\.sse\.com\.cn/disclosure/fund/announcement/c/new/\d{4}-\d{2}-\d{2}/512890_\d{8}_[A-Z0-9]+\.pdf', url):
                raise ValueError('Unexpected report URL')
            return url, report['SSEDATE']
        end = start - timedelta(days=1)
    raise ValueError('No full disclosure found in search coverage')


def fetch_holdings():
    from pypdf import PdfReader
    source, published = discover_report()
    raw = sse_download(source)
    if len(raw) > 25 * 1024 * 1024:
        raise ValueError('Report exceeds size limit')
    reader = PdfReader(io.BytesIO(raw))
    if len(reader.pages) > 200:
        raise ValueError('Report exceeds page limit')
    return parse_report('\n'.join(page.extract_text() for page in reader.pages), source, published)


def refresh(path, code, fetcher):
    old = validate(json.loads(path.read_text(encoding='utf-8'))) if path.exists() else None
    if old and old['code'] != code:
        raise ValueError('Existing snapshot identity mismatch')
    now = timestamp()
    base = {'schemaVersion': 1, 'code': code, 'unit': 'fraction' if code == 'H30269' else 'CNY', 'scope': 'full_index' if code == 'H30269' else 'full_equity'}
    base.update({'source': WEIGHTS_SOURCE} if code == 'H30269' else {'discoverySource': DISCOVERY})
    try:
        payload = validate({**base, **fetcher(), 'lastAttemptAt': now, 'lastSuccessAt': now, 'status': 'ok', 'reason': None})
        if old and old['date'] and (payload['date'] < old['date'] or (code == '512890' and payload['publishedDate'] < old['publishedDate'])):
            raise ValueError('Source date regressed')
        constituents.atomic_save(path, payload)
        print(f'{code}: {payload["date"]}, {len(payload["members"])} weighted stocks')
        return 0
    except Exception as error:
        if old and old['status'] != 'unavailable':
            payload = {**old, 'status': 'stale', 'reason': '权重／完整持仓采集失败，保留原数据及日期', 'lastAttemptAt': now}
        else:
            payload = {**base, 'date': None, 'members': [], 'status': 'unavailable', 'reason': '暂无可核验的权重／完整披露持仓', 'lastAttemptAt': now, 'lastSuccessAt': None}
            if code == '512890':
                payload.update({'source': None, 'publishedDate': None, 'netAssets': None, 'equityValue': None})
        constituents.atomic_save(path, validate(payload))
        print(f'{code}: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    results = []
    for filename, code, fetcher in [('weights-h30269.json', 'H30269', fetch_weights), ('holdings-512890.json', '512890', fetch_holdings)]:
        try:
            results.append(refresh(ROOT / filename, code, fetcher))
        except Exception as error:
            print(f'{code}: {error}', file=sys.stderr); results.append(1)
    sys.exit(max(results))
