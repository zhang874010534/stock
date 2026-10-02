import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from datetime import date

spec = importlib.util.spec_from_file_location('weights', Path(__file__).resolve().parents[1] / 'scripts/fetch-constituent-weights.py')
weights = importlib.util.module_from_spec(spec)
spec.loader.exec_module(weights)
ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-08-29/512890_20260829_K5D2.pdf'
REPORT = '''华泰柏瑞中证红利低波动交易型开放式指数证券投资基金
2026 年中期报告
2026 年 6 月 30 日
基金主代码 512890
单位：人民币元
净资产合计 1,000.00 900.00
其中：股票投资 850.10 800.00
7.3.1 期末指数投资按公允价值占基金资产净值比例大小排序的所有股票投资明细
1 000001 平安银行 100 600.00 60.00
第 44页 共 57页
2 600007 中国国贸 50 250.00 25.00
7.3.2 期末积极投资按公允价值占基金资产净值比例大小排序的所有股票投资明细
1 001248 华润新能源 10 0.10 0.01
7.4 报告期内股票投资组合的重大变动
'''


class WeightCollectorTests(unittest.TestCase):
    def test_report_reconciles_exact_values_and_ranks(self):
        payload = weights.parse_report(REPORT, SOURCE, '2026-08-29')
        self.assertEqual(len(payload['members']), 3)
        self.assertEqual(payload['members'][-1]['kind'], 'active')
        self.assertEqual(sum(row['marketValue'] for row in payload['members']), payload['equityValue'])
        for text in [REPORT.replace('512890', '159547'), REPORT.replace('所有股票投资明细', '前十名股票投资明细'), REPORT.replace('2 600007', '3 600007'), REPORT.replace('250.00 25.00', 'broken 25.00'), REPORT.replace('单位：人民币元', '单位：美元')]:
            with self.assertRaises(ValueError):
                weights.parse_report(text, SOURCE, '2026-08-29')

    def test_monthly_xls_identity_and_sum(self):
        rows = [['Date', 'Index Code', '', '', '', '', '', '', '', 'weight(%)']]
        rows += [['20260831', 'H30269', '', '', f'000{i:03}', f'股票{i}', '', '', 'Shenzhen Stock Exchange', 2] for i in range(50)]
        result = weights.parse_weights(rows)
        self.assertEqual(result['date'], '2026-08-31')
        self.assertAlmostEqual(sum(row['weight'] for row in result['members']), 1)
        rows[1][1] = '000300'
        with self.assertRaises(ValueError): weights.parse_weights(rows)

    def test_discovery_skips_quarters_and_rejects_pagination(self):
        rows = [dict(SECURITY_CODE='512890', TITLE='华泰柏瑞中证红利低波动交易型开放式指数证券投资基金2026年第2季度报告', SSEDATE='2026-07-21', URL='/quarter.pdf'), dict(SECURITY_CODE='512890', TITLE='华泰柏瑞中证红利低波动交易型开放式指数证券投资基金2026年中期报告', SSEDATE='2026-08-29', URL=SOURCE.replace('https://www.sse.com.cn', ''))]
        source, published = weights.discover_report(date(2026, 10, 2), lambda url: json.dumps({'result': rows, 'pageHelp': {'total': 2}}).encode())
        self.assertEqual(source, SOURCE); self.assertEqual(published, '2026-08-29')
        with self.assertRaises(ValueError): weights.discover_report(date(2026, 10, 2), lambda url: b'{"result": [], "pageHelp": {"total": 101}}')

    def test_refresh_preserves_last_success_on_failure_or_regression(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'weights.json'
            fixture = json.loads((ROOT / 'public/data/weights-h30269.json').read_text(encoding='utf-8'))
            weights.constituents.atomic_save(path, fixture)
            def fail(): raise ValueError('offline')
            self.assertEqual(weights.refresh(path, 'H30269', fail), 1)
            kept = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(kept['members'], fixture['members']); self.assertEqual(kept['date'], fixture['date'])
            self.assertEqual(kept['lastSuccessAt'], fixture['lastSuccessAt']); self.assertEqual(kept['status'], 'stale')
            self.assertEqual(weights.refresh(path, 'H30269', lambda: {'date': '2026-07-31', 'members': fixture['members']}), 1)
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['date'], fixture['date'])
            missing = Path(directory) / 'holdings.json'
            self.assertEqual(weights.refresh(missing, '512890', fail), 1)
            self.assertEqual(json.loads(missing.read_text(encoding='utf-8'))['status'], 'unavailable')

    def test_full_holdings_total_guards_against_silent_truncation(self):
        fixture = json.loads((ROOT / 'public/data/holdings-512890.json').read_text(encoding='utf-8'))
        weights.validate(fixture)
        fixture['members'].pop()
        with self.assertRaises(ValueError): weights.validate(fixture)

    def test_wrong_existing_instrument_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'holdings.json'
            original = (ROOT / 'public/data/weights-h30269.json').read_text(encoding='utf-8')
            path.write_text(original, encoding='utf-8')
            with self.assertRaises(ValueError): weights.refresh(path, '512890', lambda: {})
            self.assertEqual(path.read_text(encoding='utf-8'), original)


if __name__ == '__main__': unittest.main()
