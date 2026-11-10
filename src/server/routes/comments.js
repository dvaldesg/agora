import { HttpError, SCOPES, created, readBody, route } from '../http.js'
import { cleanAnchor } from '../input.js'

const STATUSES = new Set(['open', 'claimed', 'resolved'])

export function commentRoutes({ store, bus, directory, actorOf }) {
  const replyTarget = ({ parent, author }) => {
    if (!parent) return null
    return parent.author === author ? parent.assignee : parent.author
  }

  return [
    route({
      method: 'GET',
      path: /^\/api\/artifacts\/([\w-]+)\/comments$/,
      scope: SCOPES.artifact,
      handler: ({ params: [id], url }) => ({ comments: store.listComments({ artifactId: id, status: url.searchParams.get('status') || undefined }) }),
    }),

    route({
      method: 'POST',
      path: /^\/api\/artifacts\/([\w-]+)\/comments$/,
      scope: SCOPES.artifact,
      handler: async ({ req, url, params: [id] }) => {
        const body = await readBody(req)
        const text = String(body.body ?? '').trim()
        if (!text) throw new HttpError({ status: 400, message: 'body is required' })
        const author = actorOf({ req, body, url })
        const parent = body.parentId ? store.getComment({ id: body.parentId }) : null
        if (parent && parent.artifactId !== id) throw new HttpError({ status: 400, message: 'parent comment belongs to another artifact' })
        const assignee = directory.resolveName({ name: body.assignee }) ?? directory.mentionsIn({ body: text })[0] ?? null
        const version = Number.isInteger(body.version) ? store.getArtifact({ id, version: body.version }).viewedVersion : undefined
        const comment = store.createComment({
          artifactId: id,
          parentId: parent?.id,
          body: text,
          author,
          assignee,
          anchor: parent ? null : cleanAnchor({ anchor: body.anchor }),
          version,
        })
        bus.emit({
          type: 'comment.created',
          artifactId: id,
          actor: author,
          target: assignee ?? replyTarget({ parent, author }),
          payload: comment,
        })
        return created({ data: comment })
      },
    }),

    route({
      method: 'POST',
      path: /^\/api\/comments\/([\w-]+)\/status$/,
      scope: SCOPES.comment,
      handler: async ({ req, url, params: [commentId] }) => {
        const body = await readBody(req)
        if (!STATUSES.has(body.status)) throw new HttpError({ status: 400, message: 'status must be open|claimed|resolved' })
        const author = actorOf({ req, body, url })
        const existing = store.getComment({ id: commentId })
        if (body.status === 'claimed' && existing.status === 'claimed' && existing.claimedBy !== author) {
          throw new HttpError({ status: 409, message: `already claimed by ${existing.claimedBy}` })
        }
        const comment = store.updateCommentStatus({
          id: commentId,
          status: body.status,
          claimedBy: body.status === 'claimed' ? author : existing.claimedBy,
        })
        bus.emit({
          type: 'comment.updated',
          artifactId: comment.artifactId,
          actor: author,
          target: comment.author === author ? comment.assignee : comment.author,
          payload: comment,
        })
        return comment
      },
    }),
  ]
}
