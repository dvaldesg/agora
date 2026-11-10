import { isRelevant } from '../../relevance.js'
import { HttpError, LOOPBACK, SCOPES, isScoped, readBody, route } from '../http.js'
import { cleanName } from '../input.js'

const MAX_POLL_MS = 55_000
const HEARTBEAT_MS = 15_000
const PEER_EVENTS = new Set(['hello', 'presence'])
const OWNER_ONLY_EVENTS = new Set(['message.sent'])

const peersFor = ({ peers, access }) => (isScoped({ access }) ? peers.filter((peer) => peer.artifactId === access.artifactId) : peers)

const projectionFor = ({ access }) => {
  if (!isScoped({ access })) return null
  return ({ data }) => {
    if (PEER_EVENTS.has(data.type)) return { ...data, peers: peersFor({ peers: data.peers, access }) }
    if (OWNER_ONLY_EVENTS.has(data.type)) return null
    return data.artifactId === access.artifactId ? data : null
  }
}

export function realtimeRoutes({ store, bus, presence, info, shutdown }) {
  return [
    route({ method: 'GET', path: /^\/api\/health$/, scope: SCOPES.open, handler: () => ({ ok: true, seq: store.headSeq(), ...info }) }),

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

    route({
      method: 'GET',
      path: /^\/api\/presence$/,
      scope: SCOPES.filtered,
      handler: ({ access }) => ({ peers: peersFor({ peers: presence.list(), access }) }),
    }),

    route({
      method: 'POST',
      path: /^\/api\/presence\/([\w-]+)$/,
      scope: SCOPES.open,
      handler: async ({ req, params: [connId], access }) => {
        const body = await readBody(req)
        const artifactId = isScoped({ access }) ? access.artifactId : (body.artifactId ?? null)
        if (!presence.focus({ id: connId, artifactId })) throw new HttpError({ status: 404, message: 'unknown connection' })
        return { ok: true }
      },
    }),

    route({
      method: 'GET',
      path: /^\/api\/stream$/,
      scope: SCOPES.open,
      handler: ({ req, res, url, access }) => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
        const name = cleanName({ value: url.searchParams.get('name') })
        const kind = url.searchParams.get('kind') === 'agent' && !isScoped({ access }) ? 'agent' : 'human'
        store.upsertParticipant({ name, kind })
        const connId = presence.join({
          name,
          kind,
          artifactId: isScoped({ access }) ? access.artifactId : url.searchParams.get('artifact') || null,
          remote: !LOOPBACK.has(req.socket.remoteAddress),
        })
        const detach = bus.attach({ stream: res, project: projectionFor({ access }) })
        bus.send({ stream: res, data: { type: 'hello', connId, seq: store.headSeq(), peers: presence.list() } })
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
