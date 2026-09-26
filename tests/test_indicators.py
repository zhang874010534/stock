import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
import os
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('indicators', Path(__file__).resolve().parents[1] / 'scripts/fetch-indicators.py')
indicators = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indicators)


class IndicatorsTest(unittest.TestCase):
    def test_history_merges_dates_corrects_same_day_and_preserves_precision(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.json'
            first = indicators.parse_valuation(self.valuation())
            second = indicators.parse_valuation(self.valuation(PDate='2026-09-21', Petim='8.44602919'))
            self.assertTrue(indicators.save_valuation_history(path, [second, first]))
            data = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual([row['date'] for row in data['history']], ['2026-09-18', '2026-09-21'])
            self.assertEqual(data['history'][1]['pe'], 8.44602919)
            self.assertFalse(indicators.save_valuation_history(path, [first, second]))
            indicators.save_valuation_history(path, [{**second, 'pe': 8.45}])
            data = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(len(data['history']), 2)
            self.assertEqual(data['history'][1]['pe'], 8.45)

    def test_history_rejects_mixed_sources_and_bad_points_without_changing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.json'
            snapshot = indicators.parse_valuation(self.valuation())
            indicators.save_valuation_history(path, [snapshot])
            before = path.read_bytes()
            for patch in [{'source': 'other'}, {'basis': 'ttm'}, {'date': '2026-02-30'},
                          {'pe': True}, {'pb': float('nan')}, {'pe': 0}]:
                with self.subTest(patch=patch), self.assertRaises(ValueError):
                    indicators.save_valuation_history(path, [{**snapshot, **patch}])
                self.assertEqual(path.read_bytes(), before)

    def test_partial_failure_report_preserves_independent_success(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'report.json'
            with patch.dict(os.environ, {'METRICS_UPDATE_REPORT': str(report)}), \
                 patch.object(indicators, 'fetch_valuation', side_effect=ValueError('offline')), \
                 patch.object(indicators, 'fetch_dividend', return_value={'date': '2026-09-18', 'value': 4.3}), \
                 patch.object(indicators, 'download', side_effect=ValueError('bond offline')), \
                 patch.object(indicators, 'save_point', return_value=False):
                self.assertEqual(indicators.main(), 1)
            self.assertEqual(json.loads(report.read_text(encoding='utf-8'))['sources'], {
                'valuation': '估值更新失败', 'dividend': None, 'bond': '国债收益率更新失败'})

    def valuation(self, **patch):
        return {'Success': True, 'ErrCode': 0, 'Datas': {
            'IndexCode': 'H30269', 'PDate': '2026-09-18',
            'Petim': '8.37889046', 'PB': '0.777', **patch}}

    def test_valuation_preserves_precision_and_source_date(self):
        result = indicators.parse_valuation(self.valuation())
        self.assertEqual(result['pe'], 8.37889046)
        self.assertEqual(result['pb'], 0.777)
        self.assertEqual(result['date'], '2026-09-18')
        self.assertEqual(result['basis'], 'provider_unspecified')
        self.assertIsNone(result['dividendYield'])

    def test_invalid_upstream_and_wrong_index_rejected(self):
        for patch in [{'IndexCode': '000300'}, {'PDate': '2026-02-30'},
                      {'PDate': '2999-01-01'}, {'Petim': '-'}, {'PB': None},
                      {'PB': 'nan'}, {'PB': '-1'}, {'Petim': True}]:
            with self.subTest(patch=patch), self.assertRaises((ValueError, TypeError)):
                indicators.parse_valuation(self.valuation(**patch))
        with self.assertRaises(ValueError):
            indicators.parse_valuation({'Success': False, 'ErrCode': 61136403, 'Datas': None})

    def test_valuation_failure_and_regression_preserve_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'valuation.json'
            current = indicators.parse_valuation(self.valuation())
            indicators.save_payload(path, current)
            before = path.read_bytes()
            self.assertFalse(indicators.save_payload(path, current))
            with self.assertRaises(ValueError):
                indicators.save_payload(path, {**current, 'date': '2026-09-17'})
            self.assertEqual(before, path.read_bytes())

    def test_dividend_uses_total_capital_and_latest_date(self):
        rows = [['日期', 'Index Code', 'D/P2', 'D/P1'],
                ['20260907', 'H30269', 4.8, 4.3], ['20260908', 'H30269', 4.75, 4.27]]
        self.assertEqual(indicators.parse_dividend_rows(rows), {'date': '2026-09-08', 'value': 4.27})
        rows[1][1] = '000300'
        with self.assertRaises(ValueError):
            indicators.parse_dividend_rows(rows)

    def test_bond_selects_government_10y_not_other_curve_or_comment(self):
        html = '''<table><tr><th>2026-09-08(%)</th><th>7年</th><th>10<!-- 年 -->年</th></tr>
        <tr><td>中债商业银行普通债收益率曲线(AAA)</td><td>2.0</td><td>2.3</td></tr>
        <tr><td>中债国债收益率曲线</td><!--<td>99</td>--><td>1.5</td><td>1.6815</td></tr></table>'''
        self.assertEqual(indicators.parse_bond(html), {'date': '2026-09-08', 'value': 1.6815})
        with self.assertRaises(ValueError):
            indicators.parse_bond(html.replace('10<!-- 年 -->年', '30年'))

    def test_bad_values_rejected(self):
        for day, value in [('2026-02-30', 1), ('2026-09-08', float('nan')), ('2026-09-08', -1)]:
            with self.assertRaises(ValueError):
                indicators.valid_point(day, value)

    def test_unchanged_and_regressed_data_preserve_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.json'
            point = {'date': '2026-09-08', 'value': 1.6815}
            self.assertTrue(indicators.save_point(path, point, 'CN10Y', 'source', 'basis'))
            before = path.read_bytes()
            self.assertFalse(indicators.save_point(path, point, 'CN10Y', 'source', 'basis'))
            with self.assertRaises(ValueError):
                indicators.save_point(path, {'date': '2026-09-07', 'value': 1.67}, 'CN10Y', 'source', 'basis')
            self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
