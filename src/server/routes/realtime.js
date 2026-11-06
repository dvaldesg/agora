import { isRelevant } from '../../relevance.js'
import { HttpError, LOOPBACK, readBody, route } from '../http.js'
import { cleanName } from '../input.js'

const MAX_POLL_MS = 55_000
const HEARTBEAT_MS = 15_000

export function realtimeRoutes({ store, bus, presence, info, shutdown }) {
  return [
    route({ method: 'GET', path: /^\/api\/health$/, handler: () => ({ ok: true, seq: store.headSeq(), ...info }) }),

    route({
      method: 'POST',
      path: /^\/api\/shutdown$/,
      handler: ({ req }) => {
        if (!LOOPBACK.has(req.socket.remoteAddress)) throw new HttpError({ status: 403, message: 'shutdown is only allowed locally' })
        setImmediate(shutdown)
        return { ok: true }
      },
    }),

    route({
      method: 'GET',
      path: /^\/api\/events$/,
      handler: ({ url }) => {
        const since = Number(url.searchParams.get('since') ?? store.headSeq())
        const timeout = Math.min(Number(url.searchParams.get('timeout') ?? 25_000), MAX_POLL_MS)
        const agent = url.searchParams.get('agent') || undefined
        const all = url.searchParams.get('all') === '1'
        const artifactId = url.searchParams.get('artifact') || undefined
        return bus.poll({ since, timeout, filter: (event) => isRelevant({ event, agent, all, artifactId }) })
      },
    }),

    route({ method: 'GET', path: /^\/api\/presence$/, handler: () => ({ peers: presence.list() }) }),

    route({
      method: 'POST',
      path: /^\/api\/presence\/([\w-]+)$/,
      handler: async ({ req, params: [connId] }) => {
        const body = await readBody(req)
        if (!presence.focus({ id: connId, artifactId: body.artifactId ?? null })) throw new HttpError({ status: 404, message: 'unknown connection' })
        return { ok: true }
      },
    }),

    route({
      method: 'GET',
      path: /^\/api\/stream$/,
      handler: ({ req, res, url }) => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
        const name = cleanName({ value: url.searchParams.get('name') })
        const kind = url.searchParams.get('kind') === 'agent' ? 'agent' : 'human'
        store.upsertParticipant({ name, kind })
        const connId = presence.join({
          name,
          kind,
          artifactId: url.searchParams.get('artifact') || null,
          remote: !LOOPBACK.has(req.socket.remoteAddress),
        })
        res.write(`data: ${JSON.stringify({ type: 'hello', connId, seq: store.headSeq(), peers: presence.list() })}\n\n`)
        const detach = bus.attach({ stream: res })
        const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
        req.on('close', () => {
          clearInterval(heartbeat)
          detach()
          presence.leave({ id: connId })
        })
        return null
      },
    }),
  ]
}
