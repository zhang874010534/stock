import { readIndex, emptyIndex } from './database.js'
import { syncIndex } from './sync.js'

export default {
  async scheduled(controller, env) {
    controller.noRetry?.()
    const result = await syncIndex(env)
    console.log('H30269 daily sync', result)
  },

  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/h30269') {
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })
      if (!env.DB) return Response.json({ status: 'error', message: '行情数据库尚未配置' }, { status: 503 })
      try {
        return Response.json(await readIndex(env.DB, env.HISTORY_START_DATE), {
          headers: { 'Cache-Control': 'public, max-age=60' },
        })
      } catch (error) {
        // Tables are provisioned by the first scheduled run, never by a page visit.
        if (/no such table/i.test(error.message)) return Response.json(emptyIndex(), { headers: { 'Cache-Control': 'no-store' } })
        console.error('H30269 query failed', error)
        return Response.json({ status: 'error', message: '行情数据暂时无法读取，请稍后重试' }, { status: 503 })
      }
    }

    if (url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 })

    return env.ASSETS.fetch(request)
  },
}
