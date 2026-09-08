const INDICATORS = {
  dividend: { path: '/data/dividend-h30269.json', code: 'H30269', basis: 'total_share_capital' },
  treasury: { path: '/data/china-bond-10y.json', code: 'CN10Y', basis: 'government_bond_yield_curve_10y' },
}

export async function getYield(kind, { fetcher = fetch } = {}) {
  const indicator = INDICATORS[kind]
  if (!indicator) throw new Error('不支持的收益率指标')
  const response = await fetcher(`${indicator.path}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('暂时无法读取，稍后重试')
  const data = await response.json()
  const day = Date.parse(`${data.date}T00:00:00Z`)
  if (data.code !== indicator.code || data.basis !== indicator.basis || data.unit !== 'percent' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== data.date ||
      !Number.isFinite(data.value) || data.value < 0 || data.value > 100) {
    throw new Error('数据格式异常，稍后重试')
  }
  return data
}
