import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('indicators', Path(__file__).resolve().parents[1] / 'scripts/fetch-indicators.py')
indicators = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indicators)


class IndicatorsTest(unittest.TestCase):
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
