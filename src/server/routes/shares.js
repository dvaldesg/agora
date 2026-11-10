import { HttpError, LINK_LEVELS, SCOPES, created, readBody, route } from '../http.js'

const MAX_LABEL_LENGTH = 60

export function shareRoutes({ store, actorOf, artifactLinkUrl, info }) {
  const withUrl = ({ link }) => ({ ...link, url: artifactLinkUrl({ link }) })

  return [
    route({ method: 'GET', path: /^\/api\/session$/, scope: SCOPES.open, handler: ({ access }) => ({ ...access, lanEnabled: info.lan }) }),

    route({
      method: 'GET',
      path: /^\/api\/artifacts\/([\w-]+)\/links$/,
      handler: ({ params: [id] }) => ({ links: store.listShareLinks({ artifactId: id }).map((link) => withUrl({ link })), lanEnabled: info.lan }),
    }),

    route({
      method: 'POST',
      path: /^\/api\/artifacts\/([\w-]+)\/links$/,
      handler: async ({ req, url, params: [id] }) => {
        const body = await readBody(req)
        const label =
          String(body.label ?? '')
            .trim()
            .slice(0, MAX_LABEL_LENGTH) || null
        const level = body.level ?? 'read'
        if (!LINK_LEVELS[level]) throw new HttpError({ status: 400, message: `level must be one of: ${Object.keys(LINK_LEVELS).join(', ')}` })
        const link = store.createShareLink({ artifactId: id, label, level, author: actorOf({ req, body, url }) })
        return created({ data: withUrl({ link }) })
      },
    }),

    route({
      method: 'DELETE',
      path: /^\/api\/links\/([\w-]+)$/,
      handler: ({ params: [token] }) => {
        if (!store.deleteShareLink({ token })) throw new HttpError({ status: 404, message: 'link not found' })
        return { deleted: true }
      },
    }),
  ]
}
