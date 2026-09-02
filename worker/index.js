export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/h30269') {
      return Response.json({
        code: 'H30269',
        name: '中证红利低波动指数',
        status: 'ok',
      })
    }

    return env.ASSETS.fetch(request)
  },
}
