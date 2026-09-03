import axios from 'axios'

const H30269_API_URL = '/api/history'

export async function getH30269(range = '1y') {
  const { data } = await axios.get(H30269_API_URL, {
    params: { symbol: 'H30269', range },
    timeout: 20000,
    headers: {
      Accept: 'application/json',
    },
  })

  if (!Array.isArray(data?.history)) throw new Error('行情接口返回格式异常')

  return data
}
