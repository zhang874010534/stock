import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('indicators', Path(__file__).resolve().parents[1] / 'scripts/fetch-indicators.py')
indicators = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indicators)


class IndicatorsTest(unittest.TestCase):
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
