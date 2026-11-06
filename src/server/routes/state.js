import { HttpError, readBody, route } from '../http.js'

const MAX_VALUE_BYTES = 1024 * 1024
const MAX_KEY_LENGTH = 200

const scopeFor = ({ scope, actor }) => (scope === 'user' ? `user:${actor}` : 'shared')

export function stateRoutes({ store, bus, actorOf }) {
  const announce = ({ id, actor, key, isUser, value, deleted }) =>
    bus.emit({
      type: 'state.changed',
      artifactId: id,
      actor,
      target: isUser ? actor : null,
      payload: { key, scope: isUser ? 'user' : 'shared', owner: isUser ? actor : null, value: isUser ? undefined : value, deleted },
    })

  return [
    route({
      method: 'GET',
      path: /^\/api\/artifacts\/([\w-]+)\/state$/,
      handler: ({ req, url, params: [id] }) => {
        const scope = scopeFor({ scope: url.searchParams.get('scope'), actor: actorOf({ req, url }) })
        const key = url.searchParams.get('key')
        if (key !== null) return { key, value: store.getState({ artifactId: id, scope, key })?.value ?? null }
        return { items: store.listState({ artifactId: id, scope, prefix: url.searchParams.get('prefix') ?? '' }) }
      },
    }),

    route({
      method: 'PUT',
      path: /^\/api\/artifacts\/([\w-]+)\/state\/([^/]+)$/,
      handler: async ({ req, url, params: [id, rawKey] }) => {
        const body = await readBody(req)
        if (!('value' in body)) throw new HttpError({ status: 400, message: 'value is required' })
        if (JSON.stringify(body.value).length > MAX_VALUE_BYTES) throw new HttpError({ status: 413, message: 'value larger than 1MB' })
        const key = decodeURIComponent(rawKey).slice(0, MAX_KEY_LENGTH)
        const actor = actorOf({ req, body, url })
        const isUser = body.scope === 'user'
        const item = store.setState({ artifactId: id, scope: scopeFor({ scope: body.scope, actor }), key, value: body.value, author: actor })
        announce({ id, actor, key, isUser, value: item.value, deleted: false })
        return item
      },
    }),

    route({
      method: 'DELETE',
      path: /^\/api\/artifacts\/([\w-]+)\/state\/([^/]+)$/,
      handler: ({ req, url, params: [id, rawKey] }) => {
        const key = decodeURIComponent(rawKey)
        const actor = actorOf({ req, url })
        const isUser = url.searchParams.get('scope') === 'user'
        const deleted = store.deleteState({ artifactId: id, scope: scopeFor({ scope: isUser ? 'user' : 'shared', actor }), key })
        if (deleted) announce({ id, actor, key, isUser, deleted: true })
        return { deleted }
      },
    }),
  ]
}
