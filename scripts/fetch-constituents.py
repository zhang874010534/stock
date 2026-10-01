"""Refresh the official CSI H30269 membership snapshot independently."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from datetime import date, datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('indicator_fetch', Path(__file__).with_name('fetch-indicators.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/cons/H30269cons.xls'
OUTPUT = Path(__file__).resolve().parent.parent / 'public/data/constituents-h30269.json'
HISTORY_OUTPUT = OUTPUT.with_name('constituents-history-h30269.json')
INDUSTRY_SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30199_Index_Methodology_cn.pdf'
INDUSTRY_BASIS = 'csi_level1_membership_match'
INDUSTRIES = {'932077': '能源', '932078': '原材料', '932079': '工业', '932080': '可选消费',
              '932081': '主要消费', '932082': '医药卫生', '932083': '金融', '931775': '房地产',
              '932084': '信息技术', '932085': '通信服务', '932086': '公用事业'}


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def valid_day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('Invalid membership date')
    parsed = date.fromisoformat(value)
    if parsed > datetime.now(timezone(timedelta(hours=8))).date():
        raise ValueError('Future membership date')


def valid_time(value):
    if not isinstance(value, str) or not value.endswith('Z'):
        raise ValueError('Invalid observation time')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed > datetime.now(timezone.utc) + timedelta(seconds=60):
        raise ValueError('Future observation time')
    return parsed


def validate_members(members):
    if not isinstance(members, list) or len(members) != 50:
        raise ValueError('Expected 50 members')
    codes = set()
    for member in members:
        code, name, exchange = member.get('code'), member.get('name'), member.get('exchange')
        if not isinstance(code, str) or not re.fullmatch(r'\d{6}', code) or code in codes or not isinstance(name, str) or not name.strip() or exchange not in ('SSE', 'SZSE'):
            raise ValueError('Invalid or duplicate member')
        codes.add(code)


def empty_history():
    return {'schemaVersion': 1, 'code': 'H30269', 'source': SOURCE, 'industrySource': INDUSTRY_SOURCE,
            'industryBasis': INDUSTRY_BASIS, 'snapshots': [], 'membershipStatus': 'unavailable',
            'industryStatus': 'unavailable', 'membershipReason': '尚未积累名单',
            'industryReason': '尚未采集行业分类', 'lastAttemptAt': None}


def validate_history(payload):
    if any(payload.get(key) != value for key, value in {'schemaVersion': 1, 'code': 'H30269', 'source': SOURCE,
            'industrySource': INDUSTRY_SOURCE, 'industryBasis': INDUSTRY_BASIS}.items()):
        raise ValueError('Invalid membership history metadata')
    if payload.get('membershipStatus') not in ('ok', 'stale', 'unavailable') or payload.get('industryStatus') not in ('ok', 'partial', 'unavailable'):
        raise ValueError('Invalid history status')
    for status_key, reason_key in [('membershipStatus', 'membershipReason'), ('industryStatus', 'industryReason')]:
        reason = payload.get(reason_key)
        if (payload[status_key] == 'ok' and reason is not None) or (payload[status_key] != 'ok' and (not isinstance(reason, str) or not reason.strip())):
            raise ValueError('Invalid history status reason')
    if not isinstance(payload.get('snapshots'), list):
        raise ValueError('Invalid history snapshots')
    if payload.get('lastAttemptAt') is not None:
        valid_time(payload['lastAttemptAt'])
    previous_day, previous_time = '', None
    for snapshot in payload['snapshots']:
        valid_day(snapshot['date'])
        observed = valid_time(snapshot['observedAt'])
        if snapshot['date'] < previous_day or (previous_time and observed <= previous_time):
            raise ValueError('History must be ordered, without duplicate observations')
        if observed.astimezone(timezone(timedelta(hours=8))).date().isoformat() < snapshot['date']:
            raise ValueError('Observation precedes source date')
        validate_members(snapshot['members'])
        for member in snapshot['members']:
            industry = member.get('industry')
            status = member.get('industryStatus')
            if industry is None:
                if status != 'unavailable' or any(member.get(key) is not None for key in ('industryObservedAt', 'industryDate', 'industrySourceIndex')):
                    raise ValueError('Unknown industry cannot have a classification date')
            elif not isinstance(industry, str) or not industry.strip() or len(industry) > 80 or status not in ('ok', 'stale') or valid_time(member['industryObservedAt']) > observed:
                raise ValueError('Invalid industry observation')
            else:
                if INDUSTRIES.get(member.get('industrySourceIndex')) != industry:
                    raise ValueError('Invalid industry index/label')
                valid_day(member.get('industryDate'))
                if member['industryDate'] > observed.astimezone(timezone(timedelta(hours=8))).date().isoformat():
                    raise ValueError('Industry date exceeds observation')
        previous_day, previous_time = snapshot['date'], observed
    if payload['snapshots'] and payload['membershipStatus'] == 'unavailable':
        raise ValueError('Unavailable history cannot contain snapshots')
    if not payload['snapshots'] and payload['membershipStatus'] != 'unavailable':
        raise ValueError('History status requires snapshots')
    if previous_time and payload.get('lastAttemptAt') is not None and valid_time(payload['lastAttemptAt']) < previous_time:
        raise ValueError('Last attempt precedes observation')
    return payload


def append_snapshot(history, membership, observed_at, classifications=None):
    """Keep observations, never infer an effective rebalance date or backdate industries."""
    validate_members(membership['members'])
    valid_day(membership['date']); valid_time(observed_at)
    members = []
    for item in membership['members']:
        key = (item['exchange'], item['code'])
        classification = (classifications or {}).get(key, {'industry': None, 'industryStatus': 'unavailable', 'industryObservedAt': None, 'industryDate': None, 'industrySourceIndex': None})
        members.append({**item, **classification})
    members.sort(key=lambda item: item['code'])
    snapshot = {'date': membership['date'], 'observedAt': observed_at, 'members': members}
    previous = history['snapshots'][-1] if history['snapshots'] else None
    if previous and snapshot['date'] < previous['date']:
        raise ValueError('Membership history date regressed')
    # Date or content changes create a new observation, including same-date corrections.
    def content(value):
        return [{k: v for k, v in member.items() if k != 'industryObservedAt'} for member in value]
    if previous and snapshot['date'] == previous['date'] and content(members) == content(previous['members']):
        return False
    if previous and valid_time(observed_at) <= valid_time(previous['observedAt']):
        raise ValueError('Observation time did not advance')
    history['snapshots'].append(snapshot)
    return True


def parse_industry_rows(rows, index):
    if index not in INDUSTRIES or not rows or len(rows[0]) != 9:
        raise ValueError('Industry index/columns invalid')
    for position, title in [(0, 'Date'), (1, 'Index Code'), (4, 'Constituent Code'), (5, 'Constituent Name'), (8, 'Exchange(Eng)')]:
        if title not in str(rows[0][position]):
            raise ValueError('Industry header changed')
    mapping, dates = {}, set()
    for row in rows[1:]:
        if len(row) != 9 or str(row[1]).strip() != index:
            raise ValueError('Industry index identity invalid')
        raw = str(row[0]).strip()
        if not re.fullmatch(r'\d{8}', raw):
            raise ValueError('Industry source date invalid')
        day = f'{raw[:4]}-{raw[4:6]}-{raw[6:]}'
        valid_day(day); dates.add(day)
        code = str(row[4]).strip()
        exchange = {'Shanghai Stock Exchange': 'SSE', 'Shenzhen Stock Exchange': 'SZSE', 'Beijing Stock Exchange': 'BSE'}.get(str(row[8]).strip())
        key = (exchange, code)
        if not re.fullmatch(r'\d{6}', code) or not exchange or key in mapping:
            raise ValueError('Industry member invalid or duplicate')
        mapping[key] = {'industry': INDUSTRIES[index], 'industryDate': day, 'industrySourceIndex': index}
    if not mapping or len(dates) != 1:
        raise ValueError('Industry list empty or mixed source dates')
    return mapping


def merge_industry_maps(mappings):
    result = {}
    for mapping in mappings:
        if set(mapping) & set(result):
            raise ValueError('Conflicting industry index membership')
        result.update(mapping)
    return result


def fetch_industries(members):
    import xlrd
    def fetch(index):
        try:
            url = SOURCE.replace('H30269cons.xls', f'{index}cons.xls')
            sheet = xlrd.open_workbook(file_contents=shared.download(url)).sheet_by_index(0)
            return parse_industry_rows([sheet.row_values(i) for i in range(sheet.nrows)], index), None
        except Exception as error:
            print(f'Industry index {index} failed: {error}', file=sys.stderr)
            return {}, index
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(fetch, INDUSTRIES))
    return merge_industry_maps([mapping for mapping, _ in results]), [error for _, error in results if error]


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
    if old and old.get('status') != 'unavailable':
        valid_day(old.get('date'))
        validate_members(old.get('members'))
    try:
        payload = fetcher()
        if payload.get('schemaVersion') != 1 or payload.get('code') != 'H30269' or payload.get('source') != SOURCE or payload.get('status') != 'ok':
            raise ValueError('Constituent fetch metadata invalid')
        valid_day(payload.get('date')); validate_members(payload.get('members'))
        if payload.get('count') != len(payload['members']):
            raise ValueError('Constituent count invalid')
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


def refresh_with_history(path=OUTPUT, history_path=HISTORY_OUTPUT, member_fetcher=fetch_members, industry_fetcher=fetch_industries):
    # Validate the archive before changing any files. Never reset a corrupt archive.
    history = validate_history(json.loads(history_path.read_text(encoding='utf-8'))) if history_path.exists() else empty_history()
    previous = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    if not history['snapshots'] and previous and previous.get('members'):
        append_snapshot(history, previous, previous['updatedAt'])
        history['membershipStatus'] = 'ok'
        history['membershipReason'] = None
    membership_result = refresh(path, member_fetcher)
    current = json.loads(path.read_text(encoding='utf-8'))
    history['membershipStatus'] = current['status']
    history['membershipReason'] = current.get('reason')
    classifications, failures = {}, []
    if membership_result == 0:
        prior = {(member['exchange'], member['code']): member for snapshot in history['snapshots'] for member in snapshot['members'] if member.get('industry')}
        try:
            mapping, failures = industry_fetcher(current['members'])
        except Exception as error:
            print(f'Industry classification failed: {error}', file=sys.stderr)
            mapping, failures = {}, list(INDUSTRIES)
        observed_at = utc_now()
        for member in current['members']:
            key = (member['exchange'], member['code'])
            if key in mapping:
                classifications[key] = {**mapping[key], 'industryStatus': 'ok', 'industryObservedAt': observed_at}
            else:
                old = prior.get(key) if failures else None
                classifications[key] = {'industry': old.get('industry') if old else None,
                    'industryStatus': 'stale' if old else 'unavailable',
                    'industryObservedAt': old.get('industryObservedAt') if old else None,
                    'industryDate': old.get('industryDate') if old else None,
                    'industrySourceIndex': old.get('industrySourceIndex') if old else None}
        append_snapshot(history, current, observed_at, classifications)
        known = sum(item['industry'] is not None for item in classifications.values())
        history['industryStatus'] = 'ok' if not failures and known == 50 else 'partial' if known else 'unavailable'
        history['industryReason'] = (f'{len(failures)} 份行业名单更新失败，保留已知分类；' if failures else '') + f'{50 - known} 只未匹配，计入未分类' if history['industryStatus'] != 'ok' else None
        history['membershipStatus'] = 'ok'
    history['lastAttemptAt'] = utc_now()
    validate_history(history)
    atomic_save(history_path, history)
    print(f'Membership history: {len(history["snapshots"])} observations, industry: {history["industryStatus"]}')
    return 1 if membership_result or failures else 0


if __name__ == '__main__':
    try:
        sys.exit(refresh_with_history())
    except Exception as error:
        print(f'Constituent history update failed: {error}', file=sys.stderr)
        sys.exit(1)
