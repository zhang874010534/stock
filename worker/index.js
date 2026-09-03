import { INSTRUMENTS, RANGES, MarketDataError, fetchHistory } from './market-data.js'

const CACHE_SECONDS = 60

export function createWorker({ fetcher = fetch, now = () => new Date(), getCache = () => globalThis.caches?.default } = {}) {
  const pending = new Map()
  let cooldown = null

  async function readCache(key) {
    try {
      const response = await getCache()?.match(key)
      const entry = response ? await response.json() : null
      return entry?.expiresAt > now().getTime() ? entry : null
    } catch {
      return null
    }
  }

  async function writeCache(key, entry) {
    try {
      // 内部统一存为 200，错误对外仍返回 503 且禁止浏览器缓存。
      await getCache()?.put(key, Response.json(entry, {
        headers: { 'Cache-Control': `public, max-age=${Math.max(1, Math.ceil((entry.expiresAt - now().getTime()) / 1000))}` },
      }))
    } catch (error) {
      console.warn('行情短缓存写入失败', error.message)
    }
  }

  function respond(entry) {
    const remaining = Math.max(0, Math.ceil((entry.expiresAt - now().getTime()) / 1000))
    return Response.json(entry.body, {
      status: entry.status,
      headers: entry.status === 200
        ? { 'Cache-Control': `public, max-age=${remaining}` }
        : { 'Cache-Control': 'no-store', 'Retry-After': String(remaining) },
    })
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url)
      if (url.pathname !== '/api/history' && url.pathname !== '/api/h30269') {
        if (url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 })
        return env.ASSETS.fetch(request)
      }
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })
      const symbol = url.pathname === '/api/h30269' ? 'H30269' : (url.searchParams.get('symbol') ?? 'H30269').toUpperCase()
      const range = url.searchParams.get('range') ?? '1y'
      const instrument = INSTRUMENTS.get(symbol)
      if (!instrument || !RANGES.has(range)) return Response.json({ status: 'error', message: '不支持的证券代码或时间范围' }, { status: 400 })

      // 固定参数形成缓存键；时间戳等多余参数不能强制绕过缓存。
      const key = new Request(`${url.origin}/__market_cache/v1/${symbol}/${range}`)
      const cooldownKey = new Request(`${url.origin}/__market_cache/v1/eastmoney-cooldown`)
      const cached = await readCache(key)
      if (cached) return respond(cached)
      if (!cooldown || cooldown.expiresAt <= now().getTime()) cooldown = await readCache(cooldownKey)
      if (cooldown) return respond(cooldown)

      if (!pending.has(key.url)) {
        const job = (async () => {
          let entry
          try {
            const body = await fetchHistory(instrument, range, { fetcher, now: now() })
            entry = { status: 200, body, expiresAt: now().getTime() + CACHE_SECONDS * 1000 }
          } catch (error) {
            console.warn('东方财富行情请求失败', error.cause?.message ?? error.message)
            const delay = error instanceof MarketDataError ? error.cooldownSeconds : 0
            entry = {
              status: 503,
              body: { status: 'error', message: error instanceof MarketDataError ? error.message : '行情暂时不可用，请稍后再试' },
              expiresAt: now().getTime() + (delay || CACHE_SECONDS) * 1000,
            }
            if (delay) {
              cooldown = entry
              await writeCache(cooldownKey, entry)
            }
          }
          await writeCache(key, entry)
          return entry
        })()
        pending.set(key.url, job)
        job.finally(() => pending.delete(key.url))
      }
      return respond(await pending.get(key.url))
    },
  }
}

export default createWorker()
