const RANGES = new Set(['1m', '3m', '6m', '1y', '3y', '5y', 'all'])

function unavailable(message = '行情服务暂时不可用，请稍后再试', code = 'backend_unavailable') {
  return Response.json({ status: 'error', code, message }, {
    status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
  })
}

export function createWorker({ fetcher = fetch, timeoutMs = 65_000 } = {}) {
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
      if (symbol !== 'H30269' || !RANGES.has(range)) {
        return Response.json({ status: 'error', message: '不支持的证券代码或时间范围' }, { status: 400 })
      }
      if (!env.AKSHARE_API_URL) return unavailable('行情服务尚未就绪，请稍后再试', 'backend_not_configured')

      let upstream
      try {
        const base = new URL(env.AKSHARE_API_URL)
        const localHttp = base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
        if ((!localHttp && base.protocol !== 'https:') || base.username || base.password || base.origin === url.origin) throw new Error('Invalid backend URL')
        upstream = new URL('/api/history', base)
        upstream.search = new URLSearchParams({ symbol, range }).toString()
      } catch {
        return unavailable('行情服务配置异常，请稍后再试', 'invalid_backend_url')
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const headers = { Accept: 'application/json' }
        if (env.AKSHARE_API_TOKEN) headers.Authorization = `Bearer ${env.AKSHARE_API_TOKEN}`
        const response = await fetcher(upstream, { headers, signal: controller.signal, redirect: 'manual' })
        if (!response.headers.get('Content-Type')?.includes('application/json')) return unavailable()
        const data = await response.json()
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) return unavailable('行情服务暂时不可用，请稍后再试', 'backend_auth_failed')
          const retry = response.headers.get('Retry-After')
          return Response.json({ status: 'error', code: data.code, message: typeof data.message === 'string' ? data.message.slice(0, 200) : '行情获取失败，请稍后再试' }, {
            status: response.status === 400 ? 400 : 503,
            headers: { 'Cache-Control': 'no-store', 'Retry-After': /^\d+$/.test(retry ?? '') ? retry : '60' },
          })
        }
        if (data.provider !== 'AKShare' || data.code !== symbol || data.range !== range || !Array.isArray(data.history)) {
          return unavailable('行情返回格式异常，请稍后再试', 'invalid_backend_response')
        }
        // 短缓存由 Python 服务统一管理；不在边缘再续期60秒。
        const maxAge = Math.min(60, Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] ?? 0))
        return Response.json(data, { headers: { 'Cache-Control': `public, max-age=${maxAge}` } })
      } catch {
        return unavailable(controller.signal.aborted ? '行情服务启动或查询超时，请稍后重试' : '行情服务暂时无法连接，请稍后重试')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export default createWorker()
