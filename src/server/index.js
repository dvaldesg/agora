import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPresence } from '../presence.js'
import { createBus } from './bus.js'
import { createDirectory } from './directory.js'
import { LOOPBACK, parseCookies, sendJson, statusOf } from './http.js'
import { cleanName } from './input.js'
import { artifactRoutes } from './routes/artifacts.js'
import { commentRoutes } from './routes/comments.js'
import { peopleRoutes } from './routes/people.js'
import { realtimeRoutes } from './routes/realtime.js'
import { stateRoutes } from './routes/state.js'
import { webRoutes } from './routes/web.js'

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web')

const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address ?? null

const isResponse = (result) => result && typeof result === 'object' && 'status' in result && 'data' in result

export function startServer({ store, port, lan = false, token = null, maxVersions }) {
  const bus = createBus({ store })
  const presence = createPresence({ onChange: ({ peers }) => bus.broadcast({ data: { type: 'presence', peers } }) })
  const directory = createDirectory({ store })
  const server = createServer()

  const actorOf = ({ req, body, url }) => cleanName({ value: body?.author ?? req.headers['x-agora-actor'] ?? url.searchParams.get('as') })

  const shareLinks = ({ id }) => {
    const ip = lanAddress()
    const path = id ? `/a/${id}` : '/'
    return {
      local: `http://127.0.0.1:${port}${path}`,
      lan: lan && ip ? `http://${ip}:${port}${path}?t=${token}` : null,
      port,
      lanEnabled: lan,
    }
  }

  const shutdown = () => {
    server.closeAllConnections()
    server.close(() => process.exit(0))
  }

  const context = { store, bus, presence, directory, actorOf, shareLinks, shutdown, webDir: WEB_DIR, info: { port, lan, maxVersions } }
  const routes = [
    ...realtimeRoutes(context),
    ...artifactRoutes(context),
    ...commentRoutes(context),
    ...stateRoutes(context),
    ...peopleRoutes(context),
    ...webRoutes(context),
  ]

  const isAuthorized = ({ req, url, res }) => {
    if (LOOPBACK.has(req.socket.remoteAddress)) return true
    if (!token) return false
    if (url.searchParams.get('t') === token) {
      res.setHeader('set-cookie', `agora_t=${token}; Path=/; HttpOnly; SameSite=Lax`)
      return true
    }
    return parseCookies({ header: req.headers.cookie }).agora_t === token
  }

  server.on('request', async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    if (!isAuthorized({ req, url, res })) return sendJson({ res, status: 401, data: { error: 'missing or invalid share token' } })
    const match = routes.find((candidate) => candidate.method === req.method && candidate.path.test(url.pathname))
    if (!match) return sendJson({ res, status: 404, data: { error: 'not found' } })
    try {
      const result = await match.handler({ req, res, url, params: match.path.exec(url.pathname).slice(1) })
      if (result === null) return
      if (isResponse(result)) return sendJson({ res, status: result.status, data: result.data })
      sendJson({ res, data: result })
    } catch (error) {
      if (res.headersSent) return res.end()
      sendJson({ res, status: statusOf({ error }), data: { error: error.message } })
    }
  })
  server.requestTimeout = 0

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => resolve({ server, share: shareLinks({}) }))
  })
}
