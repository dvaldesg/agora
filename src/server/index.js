import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPresence } from '../presence.js'
import { createBus } from './bus.js'
import { createDirectory } from './directory.js'
import { FULL_ACCESS, HttpError, LOOPBACK, SCOPES, artifactAccess, isScoped, parseCookies, sendJson, statusOf } from './http.js'
import { cleanName } from './input.js'
import { artifactRoutes } from './routes/artifacts.js'
import { commentRoutes } from './routes/comments.js'
import { peopleRoutes } from './routes/people.js'
import { realtimeRoutes } from './routes/realtime.js'
import { shareRoutes } from './routes/shares.js'
import { stateRoutes } from './routes/state.js'
import { webRoutes } from './routes/web.js'

const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip']

const rememberCookie = ({ res, name, value }) => res.appendHeader('set-cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`)

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

  const networkBase = () => {
    const ip = lanAddress()
    return lan && ip ? `http://${ip}:${port}` : null
  }

  const shareLinks = ({ id }) => {
    const path = id ? `/a/${id}` : '/'
    const base = networkBase()
    return {
      local: `http://127.0.0.1:${port}${path}`,
      lan: base ? `${base}${path}?t=${token}` : null,
      port,
      lanEnabled: lan,
    }
  }

  const artifactLinkUrl = ({ link }) => `${networkBase() ?? `http://127.0.0.1:${port}`}/a/${link.artifactId}?s=${link.token}`

  const shutdown = () => {
    server.closeAllConnections()
    server.close(() => process.exit(0))
  }

  const context = {
    store,
    bus,
    presence,
    directory,
    actorOf,
    shareLinks,
    artifactLinkUrl,
    shutdown,
    webDir: WEB_DIR,
    info: { port, lan, maxVersions },
  }
  const routes = [
    ...realtimeRoutes(context),
    ...artifactRoutes(context),
    ...commentRoutes(context),
    ...stateRoutes(context),
    ...peopleRoutes(context),
    ...shareRoutes(context),
    ...webRoutes(context),
  ]

  const isLocal = ({ req }) => LOOPBACK.has(req.socket.remoteAddress) && !PROXY_HEADERS.some((header) => req.headers[header])

  const accessFor = ({ req, url, res }) => {
    if (isLocal({ req })) return FULL_ACCESS
    const cookies = parseCookies({ header: req.headers.cookie })
    const ownerToken = url.searchParams.get('t') ?? cookies.agora_t
    if (token && ownerToken === token) {
      if (url.searchParams.has('t')) rememberCookie({ res, name: 'agora_t', value: token })
      return FULL_ACCESS
    }
    const linkToken = url.searchParams.get('s') ?? cookies.agora_s
    const link = linkToken ? store.findShareLink({ token: linkToken }) : null
    if (!link) return null
    if (url.searchParams.has('s')) rememberCookie({ res, name: 'agora_s', value: link.token })
    return artifactAccess({ artifactId: link.artifactId })
  }

  const permits = ({ access, match, params }) => {
    if (!isScoped({ access })) return true
    const checks = {
      [SCOPES.open]: () => true,
      [SCOPES.filtered]: () => true,
      [SCOPES.artifact]: () => params[0] === access.artifactId,
      [SCOPES.comment]: () => store.getComment({ id: params[0] }).artifactId === access.artifactId,
    }
    return checks[match.scope]?.() ?? false
  }

  server.on('request', async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    const access = accessFor({ req, url, res })
    if (!access) return sendJson({ res, status: 401, data: { error: 'missing or invalid share token' } })
    const match = routes.find((candidate) => candidate.method === req.method && candidate.path.test(url.pathname))
    if (!match) return sendJson({ res, status: 404, data: { error: 'not found' } })
    try {
      const params = match.path.exec(url.pathname).slice(1)
      if (!permits({ access, match, params })) throw new HttpError({ status: 403, message: 'this link only gives access to one artifact' })
      const result = await match.handler({ req, res, url, params, access })
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
