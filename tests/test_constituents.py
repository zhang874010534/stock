import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('constituents', Path(__file__).resolve().parents[1] / 'scripts/fetch-constituents.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConstituentsTest(unittest.TestCase):
    def rows(self):
        header = ['Date', 'Index Code', '', '', 'Constituent Code', 'Constituent Name', '', '', 'Exchange(Eng)']
        return [header] + [['20260924', 'H30269', '', '', f'{i:06}', f'证券{i}', '', '', 'Shenzhen Stock Exchange'] for i in range(1, 51)]

    def test_parse_and_reject_incomplete_mixed_or_duplicate_rows(self):
        data = module.parse_rows(self.rows())
        self.assertEqual(data['members'][0]['code'], '000001')
        self.assertEqual(data['date'], '2026-09-24')
        self.assertEqual(data['count'], 50)
        for column, value in [(0, '29990101'), (0, '20260923'), (1, '000300'), (4, '000002'), (5, ''), (8, 'unknown')]:
            rows = self.rows()
            rows[1][column] = value
            with self.subTest(column=column), self.assertRaises(ValueError):
                module.parse_rows(rows)
        with self.assertRaises(ValueError):
            module.parse_rows(self.rows()[:-1])

    def test_failure_regression_recovery_and_no_change(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            fetcher = lambda: module.parse_rows(self.rows())
            self.assertEqual(module.refresh(path, fetcher), 0)
            original = path.read_bytes()
            self.assertEqual(module.refresh(path, fetcher), 0)
            self.assertEqual(path.read_bytes(), original)
            def fail():
                raise ValueError('offline')
            self.assertEqual(module.refresh(path, fail), 1)
            stale = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(stale['status'], 'stale')
            self.assertEqual(stale['date'], '2026-09-24')
            self.assertEqual(stale['members'], fetcher()['members'])
            self.assertEqual(module.refresh(path, lambda: {**fetcher(), 'date': '2026-09-23'}), 1)
            self.assertEqual(module.refresh(path, fetcher), 0)
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['status'], 'ok')
            empty = Path(directory) / 'empty.json'
            self.assertEqual(module.refresh(empty, fail), 1)
            self.assertEqual(json.loads(empty.read_text(encoding='utf-8'))['status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
