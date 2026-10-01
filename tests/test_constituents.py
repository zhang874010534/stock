import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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

    def test_industry_files_validate_source_dates_identity_and_beijing_members(self):
        rows = self.rows()
        for row in rows[1:]:
            row[1] = '932083'
        rows[-1][8] = 'Beijing Stock Exchange'
        result = module.parse_industry_rows(rows, '932083')
        self.assertEqual(result[('SZSE', '000001')]['industry'], '金融')
        self.assertEqual(result[('BSE', '000050')]['industryDate'], '2026-09-24')
        for column, value in [(0, '20260923'), (0, '29990101'), (1, '932079'), (4, '000002'), (8, 'unknown')]:
            bad = [list(row) for row in rows]; bad[1][column] = value
            with self.subTest(column=column), self.assertRaises(ValueError):
                module.parse_industry_rows(bad, '932083')
        with self.assertRaises(ValueError):
            module.merge_industry_maps([result, result])

    def test_history_accumulates_without_overwriting_same_date_corrections_or_backdating_industries(self):
        with tempfile.TemporaryDirectory() as directory:
            path, archive = Path(directory) / 'current.json', Path(directory) / 'history.json'
            data = module.parse_rows(self.rows())
            mapping = {('SZSE', member['code']): {'industry': '金融', 'industryDate': '2026-09-24', 'industrySourceIndex': '932083'} for member in data['members']}
            fetch_members = lambda: {**data, 'members': [dict(member) for member in data['members']]}
            self.assertEqual(module.refresh_with_history(path, archive, fetch_members, lambda members: (mapping, [])), 0)
            first = json.loads(archive.read_text(encoding='utf-8'))
            self.assertEqual(len(first['snapshots']), 1)
            self.assertEqual(module.refresh_with_history(path, archive, fetch_members, lambda members: (mapping, [])), 0)
            self.assertEqual(len(json.loads(archive.read_text(encoding='utf-8'))['snapshots']), 1)
            data['members'][0]['name'] = '新名称'
            self.assertEqual(module.refresh_with_history(path, archive, fetch_members, lambda members: (mapping, [])), 0)
            revised = json.loads(archive.read_text(encoding='utf-8'))
            self.assertEqual(len(revised['snapshots']), 2)
            self.assertEqual(revised['snapshots'][0]['members'][0]['name'], '证券1')
            self.assertEqual(revised['snapshots'][1]['date'], revised['snapshots'][0]['date'])
            del mapping[('SZSE', '000001')]
            self.assertEqual(module.refresh_with_history(path, archive, fetch_members, lambda members: (mapping, ['932083'])), 1)
            partial = json.loads(archive.read_text(encoding='utf-8'))
            saved = partial['snapshots'][-1]['members'][0]
            self.assertEqual(saved['industryStatus'], 'stale')
            self.assertEqual(saved['industryObservedAt'], revised['snapshots'][-1]['members'][0]['industryObservedAt'])
            def fail():
                raise ValueError('offline')
            with patch.object(module, 'fetch_industries', side_effect=AssertionError('should not fetch')):
                self.assertEqual(module.refresh_with_history(path, archive, fail, lambda _: self.fail('industry fetch on failed membership')), 1)
            stale = json.loads(archive.read_text(encoding='utf-8'))
            self.assertEqual(stale['membershipStatus'], 'stale')
            self.assertEqual(stale['snapshots'], partial['snapshots'])

    def test_unknown_classification_bootstrap_and_corrupt_archive_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path, archive = Path(directory) / 'current.json', Path(directory) / 'history.json'
            data = module.parse_rows(self.rows())
            module.atomic_save(path, {**data, 'updatedAt': '2026-09-24T10:00:00Z'})
            mapping = {('SZSE', member['code']): {'industry': '金融', 'industryDate': '2026-09-24', 'industrySourceIndex': '932083'} for member in data['members'][:45]}
            self.assertEqual(module.refresh_with_history(path, archive, lambda: data.copy(), lambda _: (mapping, [])), 0)
            history = json.loads(archive.read_text(encoding='utf-8'))
            self.assertEqual(len(history['snapshots']), 2)
            self.assertTrue(all(member['industry'] is None for member in history['snapshots'][0]['members']))
            self.assertEqual(sum(member['industry'] is None for member in history['snapshots'][-1]['members']), 5)
            self.assertEqual(history['industryStatus'], 'partial')
            history['snapshots'][-1]['members'][0]['industrySourceIndex'] = '932079'
            module.atomic_save(archive, history)
            saved = archive.read_bytes()
            with self.assertRaises(ValueError):
                module.refresh_with_history(path, archive, lambda: self.fail('must validate before fetching'), lambda _: ({}, []))
            self.assertEqual(archive.read_bytes(), saved)


if __name__ == '__main__':
    unittest.main()
