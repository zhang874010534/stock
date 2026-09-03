export const INDEX_CODE = 'H30269'
export const INDEX_NAME = '中证红利低波动指数'
export const DEFAULT_HISTORY_START = '2005-12-30'

// Compatible with the four-column index_daily table created in the D1 console.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS index_daily (
    code TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    close REAL NOT NULL CHECK (close > 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (code, trade_date)
  )`,
  `CREATE TABLE IF NOT EXISTS index_sync_coverage (
    code TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    PRIMARY KEY (code, start_date),
    CHECK (start_date <= end_date)
  )`,
  `CREATE TABLE IF NOT EXISTS index_sync_state (
    code TEXT PRIMARY KEY,
    paused INTEGER NOT NULL DEFAULT 0,
    retry_after TEXT,
    last_success_at TEXT,
    last_error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS index_sync_runs (
    code TEXT NOT NULL,
    run_date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    request_count INTEGER NOT NULL DEFAULT 0,
    rows_written INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    error TEXT,
    PRIMARY KEY (code, run_date)
  )`,
]

export async function ensureSchema(db) {
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)))
  await db.prepare('INSERT INTO index_sync_state (code) VALUES (?) ON CONFLICT DO NOTHING').bind(INDEX_CODE).run()
}

export async function readCoverage(db) {
  const { results } = await db.prepare(
    'SELECT start_date AS start, end_date AS end FROM index_sync_coverage WHERE code = ? ORDER BY start_date',
  ).bind(INDEX_CODE).all()
  return results
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

export function mergeCoverage(windows) {
  const merged = []
  for (const window of [...windows].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = merged.at(-1)
    if (last && window.start <= addDays(last.end, 1)) {
      last.end = last.end > window.end ? last.end : window.end
    } else {
      merged.push({ ...window })
    }
  }
  return merged
}

export async function saveWindow(db, window, rows, timestamp) {
  const coverage = mergeCoverage([...await readCoverage(db), window])
  const statements = []
  // D1 allows at most 100 bound parameters per statement. 20 rows use 80.
  for (let offset = 0; offset < rows.length; offset += 20) {
    const chunk = rows.slice(offset, offset + 20)
    statements.push(db.prepare(`
      INSERT INTO index_daily (code, trade_date, close, updated_at)
      VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}
      ON CONFLICT(code, trade_date) DO UPDATE SET close = excluded.close, updated_at = excluded.updated_at
    `).bind(...chunk.flatMap((row) => [INDEX_CODE, row.date, row.close, timestamp])))
  }
  statements.push(db.prepare('DELETE FROM index_sync_coverage WHERE code = ?').bind(INDEX_CODE))
  for (const range of coverage) {
    statements.push(db.prepare('INSERT INTO index_sync_coverage (code, start_date, end_date) VALUES (?, ?, ?)')
      .bind(INDEX_CODE, range.start, range.end))
  }
  statements.push(db.prepare('UPDATE index_sync_state SET last_success_at = ?, last_error = NULL, retry_after = NULL WHERE code = ?')
    .bind(timestamp, INDEX_CODE))
  // Rows and progress commit together; failed writes must never advance progress.
  await db.batch(statements)
}

export async function readIndex(db, historyStart = DEFAULT_HISTORY_START) {
  const [{ results: history }, state, run, coverage] = await Promise.all([
    db.prepare('SELECT trade_date AS date, close FROM index_daily WHERE code = ? ORDER BY trade_date').bind(INDEX_CODE).all(),
    db.prepare('SELECT * FROM index_sync_state WHERE code = ?').bind(INDEX_CODE).first(),
    db.prepare('SELECT * FROM index_sync_runs WHERE code = ? ORDER BY run_date DESC LIMIT 1').bind(INDEX_CODE).first(),
    readCoverage(db),
  ])
  return {
    code: INDEX_CODE,
    name: INDEX_NAME,
    status: history.length ? 'ok' : 'empty',
    source: '中证指数',
    history,
    latest: history.at(-1) ?? null,
    updatedAt: state?.last_success_at ?? null,
    sync: {
      status: state?.paused ? 'paused' : run?.status ?? 'pending',
      lastError: state?.last_error ?? null,
      retryAfter: state?.retry_after ?? null,
      requestedHistoryStart: historyStart,
      historyComplete: coverage.length === 1 && coverage[0].start <= historyStart,
      checkedFrom: coverage[0]?.start ?? null,
      lastRunDate: run?.run_date ?? null,
      lastRunRequests: run?.request_count ?? 0,
    },
  }
}

export function emptyIndex() {
  return { code: INDEX_CODE, name: INDEX_NAME, status: 'empty', source: '中证指数', history: [], latest: null, updatedAt: null, sync: { status: 'pending', historyComplete: false } }
}
