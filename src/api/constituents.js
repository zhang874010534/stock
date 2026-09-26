export const CONSTITUENTS_SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/cons/H30269cons.xls'

export async function getConstituents({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/constituents-h30269.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('成分股读取失败')
  const data = await response.json()
  const fail = () => { throw new Error('成分股数据格式异常') }
  if (data?.schemaVersion !== 1 || data.code !== 'H30269' || data.source !== CONSTITUENTS_SOURCE || !Array.isArray(data.members) || data.count !== data.members.length || !['ok', 'stale', 'unavailable'].includes(data.status)) fail()
  if (data.status === 'unavailable') {
    if (data.count !== 0 || data.date !== null || typeof data.reason !== 'string' || !data.reason) fail()
  } else {
    const day = Date.parse(`${data.date}T00:00:00Z`)
    if (data.count !== 50 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== data.date || data.date > new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) fail()
    if (data.status === 'stale' && (typeof data.reason !== 'string' || !data.reason)) fail()
    const codes = new Set()
    for (const item of data.members) {
      if (!/^\d{6}$/.test(item.code) || codes.has(item.code) || typeof item.name !== 'string' || !item.name.trim() || !['SSE', 'SZSE'].includes(item.exchange)) fail()
      codes.add(item.code)
    }
  }
  return data
}
