import { HttpError, SCOPES, created, isScoped, readBody, route } from '../http.js'
import { cleanName } from '../input.js'

const parseHookUrl = ({ value }) => {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol)) return url.toString()
  } catch {}
  throw new HttpError({ status: 400, message: 'url must be a valid http(s) URL' })
}

export function peopleRoutes({ store, bus, presence, directory, actorOf }) {
  const announceParticipants = () => bus.broadcast({ data: { type: 'presence', peers: presence.list() } })

  return [
    route({
      method: 'GET',
      path: /^\/api\/participants$/,
      scope: SCOPES.open,
      handler: ({ access }) => {
        const online = new Set(presence.list().map((peer) => peer.name.toLowerCase()))
        const visible = store.listParticipants().filter((participant) => !isScoped({ access }) || participant.kind === 'human')
        return {
          participants: visible.map((participant) => ({ ...participant, online: online.has(participant.name.toLowerCase()) })),
        }
      },
    }),

    route({
      method: 'POST',
      path: /^\/api\/participants$/,
      handler: async ({ req }) => {
        const body = await readBody(req)
        const name = cleanName({ value: body.name })
        store.upsertParticipant({ name, kind: body.kind === 'human' ? 'human' : 'agent' })
        announceParticipants()
        return created({ data: store.findParticipant({ name }) })
      },
    }),

    route({
      method: 'GET',
      path: /^\/api\/messages$/,
      handler: ({ url, access }) => ({
        messages: store.listMessages({
          artifactId: isScoped({ access }) ? access.artifactId : url.searchParams.get('artifact') || undefined,
          onlyArtifact: isScoped({ access }),
          participant: url.searchParams.get('participant') || undefined,
        }),
      }),
    }),

    route({
      method: 'POST',
      path: /^\/api\/messages$/,
      handler: async ({ req, url, access }) => {
        const body = await readBody(req)
        const text = String(body.body ?? '').trim()
        if (!text) throw new HttpError({ status: 400, message: 'body is required' })
        const sender = actorOf({ req, body, url })
        const recipient = directory.resolveName({ name: body.to ?? 'all' }) ?? cleanName({ value: body.to })
        const artifactId = isScoped({ access }) ? access.artifactId : body.artifactId
        const message = store.createMessage({ artifactId, sender, recipient, body: text })
        bus.emit({ type: 'message.sent', artifactId: message.artifactId, actor: sender, target: recipient, payload: message })
        return created({ data: message })
      },
    }),

    route({ method: 'GET', path: /^\/api\/hooks$/, handler: () => ({ hooks: store.listHooks() }) }),

    route({
      method: 'POST',
      path: /^\/api\/hooks$/,
      handler: async ({ req }) => {
        const body = await readBody(req)
        const name = cleanName({ value: body.name })
        const url = parseHookUrl({ value: body.url })
        store.upsertParticipant({ name, kind: 'agent' })
        announceParticipants()
        return created({ data: store.createHook({ name, url }) })
      },
    }),

    route({
      method: 'DELETE',
      path: /^\/api\/hooks\/([\w-]+)$/,
      handler: ({ params: [id] }) => {
        if (!store.deleteHook({ id })) throw new HttpError({ status: 404, message: 'hook not found' })
        return { deleted: true }
      },
    }),
  ]
}
