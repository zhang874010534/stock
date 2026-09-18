export const VALUATION_SOURCE = 'https://fundztapi.eastmoney.com/FundSpecialApiNew/FundSpecialZSB30ZSIndex?IndexCode=H30269&Version=6.5.5&deviceid=-&pageIndex=1&pageSize=10000&plat=Iphone&product=EFund'

export async function getValuation({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/valuation-h30269.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('暂时无法读取估值')
  const data = await response.json()
  const day = Date.parse(`${data?.date}T00:00:00Z`)
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  if (!data || data.code !== 'H30269' || data.provider !== 'Eastmoney' || data.source !== VALUATION_SOURCE ||
      data.basis !== 'provider_unspecified' || data.unit !== 'multiple' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(day) ||
      new Date(day).toISOString().slice(0, 10) !== data.date || data.date > today ||
      ![data.pe, data.pb].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('估值数据格式异常')
  }
  return data
}
