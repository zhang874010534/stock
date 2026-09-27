export const CSI_VALUATION_SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls'

export function validateCsiHistory(data) {
  if (!data || data.schemaVersion !== 1 || data.code !== 'H30269' || data.provider !== 'CSI' ||
      data.source !== CSI_VALUATION_SOURCE || data.basis !== 'dual_share_capital' ||
      data.unit !== 'pe_multiple_dividend_percent' || data.collection !== 'rolling_file_accumulation' ||
      !Array.isArray(data.history) || !data.history.length) throw new Error('中证估值历史格式异常')
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  let previous = ''
  for (const p of data.history) {
    const day = Date.parse(`${p?.date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p?.date) || !Number.isFinite(day) ||
        new Date(day).toISOString().slice(0, 10) !== p.date || p.date > today || p.date <= previous ||
        ![p.peTotal, p.peCalculation].every(v => Number.isFinite(v) && v > 0) ||
        ![p.dividendTotal, p.dividendCalculation].every(v => Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error('中证估值记录异常')
    previous = p.date
  }
  if (data.date !== previous) throw new Error('中证估值截止日期异常')
  return data
}

export function validateCsiStatus(data) {
  if (!data || data.code !== 'H30269' || data.provider !== 'CSI' || data.source !== CSI_VALUATION_SOURCE ||
      !['ok', 'error'].includes(data.status) || !Number.isFinite(Date.parse(data.lastAttemptAt)) ||
      (data.lastSuccessAt !== null && !Number.isFinite(Date.parse(data.lastSuccessAt))) ||
      (data.status === 'ok' && !data.lastSuccessAt)) throw new Error('中证更新状态异常')
  return data
}

export async function getCsiValuationHistory({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/valuation-history-csi-h30269.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('暂时无法读取中证估值历史')
  return validateCsiHistory(await response.json())
}

export async function getCsiValuationStatus({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/valuation-csi-status-h30269.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('暂时无法读取中证更新状态')
  return validateCsiStatus(await response.json())
}

export function csiChartHistory(data, basis = 'total') {
  if (!['total', 'calculation'].includes(basis)) throw new Error('无效中证估值口径')
  return (data?.history ?? []).map(p => ({ date: p.date, pe: basis === 'total' ? p.peTotal : p.peCalculation }))
}
