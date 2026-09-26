"""Recover genuine same-source snapshots already committed to this repository."""
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('indicators', ROOT / 'scripts/fetch-indicators.py')
indicators = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indicators)


def main():
    relative = 'public/data/valuation-h30269.json'
    revisions = subprocess.check_output(['git', 'log', '--reverse', '--format=%H', '--', relative], cwd=ROOT, text=True).splitlines()
    snapshots = []
    for revision in revisions:
        snapshots.append(json.loads(subprocess.check_output(['git', 'show', f'{revision}:{relative}'], cwd=ROOT, encoding='utf-8')))
    snapshots.append(json.loads((ROOT / relative).read_text(encoding='utf-8')))
    path = ROOT / 'public/data/valuation-history-h30269.json'
    # Existing observations take precedence over old Git snapshots on repeat runs.
    if path.exists():
        existing = json.loads(path.read_text(encoding='utf-8'))
        snapshots.extend({**existing, **row} for row in existing['history'])
    indicators.save_valuation_history(path, snapshots)
    data = json.loads(path.read_text(encoding='utf-8'))
    print(f"Recovered {len(data['history'])} observations: {data['history'][0]['date']} to {data['date']}")


if __name__ == '__main__':
    main()
