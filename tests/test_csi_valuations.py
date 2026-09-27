import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('indicators', Path(__file__).resolve().parents[1] / 'scripts/fetch-indicators.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def rows():
    # Deliberately reordered columns to verify field-based parsing.
    return [['Index Code', 'D/P2', 'Date', 'P/E2', 'D/P1', 'P/E1'],
            ['H30269', 4.87, '20260924', 7.76, 4.27, 8.12],
            ['H30269', 4.87, '20260923', 7.76, 4.30, 8.08]]


class CsiValuationTest(unittest.TestCase):
    def test_fields_and_order(self):
        points = m.parse_csi_valuation_rows(rows())
        self.assertEqual(points[0]['date'], '2026-09-23')
        self.assertEqual(points[1], {'date': '2026-09-24', 'peTotal': 8.12,
                                   'peCalculation': 7.76, 'dividendTotal': 4.27, 'dividendCalculation': 4.87})

    def test_invalid_rows(self):
        for col, value in [(0, '000300'), (2, '20260230'), (3, True), (3, -1), (5, 'nan'), (1, 101)]:
            data = rows()
            data[1][col] = value
            with self.subTest(col=col, value=value), self.assertRaises(ValueError):
                m.parse_csi_valuation_rows(data)
        with self.assertRaises(ValueError):
            m.parse_csi_valuation_rows(rows() + [rows()[1]])
        data = rows()
        data[0][3] = 'other'
        with self.assertRaises(ValueError):
            m.parse_csi_valuation_rows(data)

    def test_merge_revision_keep_older_and_reject_regression(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.json'
            points = m.parse_csi_valuation_rows(rows())
            m.save_csi_valuation_history(path, points)
            self.assertFalse(m.save_csi_valuation_history(path, points))
            newer = {**points[-1], 'date': '2026-09-25', 'peTotal': 8.1234}
            revision = {**points[-1], 'peCalculation': 7.77}
            m.save_csi_valuation_history(path, [revision, newer])
            data = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(len(data['history']), 3)
            self.assertEqual(data['history'][1]['peCalculation'], 7.77)
            self.assertEqual(data['history'][-1]['peTotal'], 8.1234)
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                m.save_csi_valuation_history(path, points)
            self.assertEqual(before, path.read_bytes())
            data['provider'] = 'Eastmoney'
            path.write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaises(ValueError):
                m.save_csi_valuation_history(path, [newer])

    def test_failed_attempt_retains_history_and_last_success_then_recovers(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'OUTPUT', Path(directory)):
            m.update_csi_valuation(rows())
            history = Path(directory) / 'valuation-history-csi-h30269.json'
            status = Path(directory) / 'valuation-csi-status-h30269.json'
            before = history.read_bytes()
            success = json.loads(status.read_text(encoding='utf-8'))['lastSuccessAt']
            with patch.object(m, 'fetch_csi_rows', side_effect=ValueError('offline')), self.assertRaises(ValueError):
                m.update_csi_valuation()
            self.assertEqual(history.read_bytes(), before)
            failed = json.loads(status.read_text(encoding='utf-8'))
            self.assertEqual(failed['status'], 'error')
            self.assertEqual(failed['lastSuccessAt'], success)
            m.update_csi_valuation(rows())
            self.assertEqual(json.loads(status.read_text(encoding='utf-8'))['status'], 'ok')


if __name__ == '__main__':
    unittest.main()
