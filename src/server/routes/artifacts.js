import { createPatch } from 'diff'
import { applyEdits } from '../../edits.js'
import { HttpError, SCOPES, created, isScoped, readBody, route } from '../http.js'
import { cleanTitle, stripHtml } from '../input.js'

const diffBetween = ({ id, from, to }) => createPatch(`${id}.html`, from.html, to.html, `v${from.viewedVersion}`, `v${to.viewedVersion}`)

export function artifactRoutes({ store, bus, actorOf }) {
  const publishVersion = ({ id, baseVersion, html, author, summary, title }) => {
    const artifact = store.saveVersion({ id, baseVersion, html, author, summary, title })
    bus.emit({
      type: 'artifact.updated',
      artifactId: id,
      actor: author,
      payload: { version: artifact.version, title: artifact.title, summary: summary ?? null },
    })
    return stripHtml({ artifact })
  }

  const conflict = ({ id, baseVersion, current }) => {
    const base = store.getArtifact({ id, version: baseVersion })
    return {
      status: 409,
      data: {
        error: `version conflict: you edited v${baseVersion}, artifact is at v${current.version}. Rebase on the diff and retry with baseVersion ${current.version}.`,
        currentVersion: current.version,
        diff: diffBetween({ id, from: base, to: current }),
      },
    }
  }

  return [
    route({
      method: 'GET',
      path: /^\/api\/artifacts$/,
      scope: SCOPES.filtered,
      handler: ({ access }) => ({
        artifacts: store.listArtifacts().filter((artifact) => !isScoped({ access }) || artifact.id === access.artifactId),
      }),
    }),

    route({
      method: 'POST',
      path: /^\/api\/artifacts$/,
      handler: async ({ req, url }) => {
        const body = await readBody(req)
        if (typeof body.html !== 'string' || !body.html.trim()) throw new HttpError({ status: 400, message: 'html is required' })
        const author = actorOf({ req, body, url })
        const artifact = store.createArtifact({ title: cleanTitle({ title: body.title }), html: body.html, author })
        bus.emit({ type: 'artifact.created', artifactId: artifact.id, actor: author, payload: stripHtml({ artifact }) })
        return created({ data: stripHtml({ artifact }) })
      },
    }),

    route({
      method: 'GET',
      path: /^\/api\/artifacts\/([\w-]+)$/,
      scope: SCOPES.artifact,
      handler: ({ params: [id], url }) => {
        const version = url.searchParams.get('v')
        const since = url.searchParams.get('since')
        const artifact = store.getArtifact({ id, version: version ? Number(version) : undefined })
        if (!since) return artifact
        const base = store.getArtifact({ id, version: Number(since) })
        return { ...stripHtml({ artifact }), sinceVersion: base.viewedVersion, diff: diffBetween({ id, from: base, to: artifact }) }
      },
    }),

    route({
      method: 'DELETE',
      path: /^\/api\/artifacts\/([\w-]+)$/,
      handler: ({ req, url, params: [id] }) => {
        const artifact = store.deleteArtifact({ id })
        bus.emit({ type: 'artifact.deleted', artifactId: id, actor: actorOf({ req, url }), payload: { title: artifact.title } })
        return { deleted: true }
      },
    }),

    route({
      method: 'GET',
      path: /^\/api\/artifacts\/([\w-]+)\/versions$/,
      scope: SCOPES.artifact,
      handler: ({ params: [id] }) => ({ versions: store.listVersions({ id }) }),
    }),

    route({
      method: 'PUT',
      path: /^\/api\/artifacts\/([\w-]+)$/,
      handler: async ({ req, url, params: [id] }) => {
        const body = await readBody(req)
        const author = actorOf({ req, body, url })
        const baseVersion = Number(body.baseVersion)
        if (!Number.isInteger(baseVersion)) throw new HttpError({ status: 400, message: 'baseVersion is required' })
        const current = store.getArtifact({ id })
        if (current.version !== baseVersion) return conflict({ id, baseVersion, current })
        const html = Array.isArray(body.edits) ? applyEdits({ html: current.html, edits: body.edits }) : body.html
        if (typeof html !== 'string') throw new HttpError({ status: 400, message: 'send html or edits' })
        const title = body.title ? cleanTitle({ title: body.title }) : undefined
        if (html === current.html && !title) return { ...stripHtml({ artifact: current }), unchanged: true }
        return publishVersion({ id, baseVersion, html, author, summary: body.summary, title })
      },
    }),

    route({
      method: 'POST',
      path: /^\/api\/artifacts\/([\w-]+)\/restore$/,
      handler: async ({ req, url, params: [id] }) => {
        const body = await readBody(req)
        const source = store.getArtifact({ id, version: Number(body.version) })
        const current = store.getArtifact({ id })
        if (source.viewedVersion === current.version) throw new HttpError({ status: 400, message: 'that is already the latest version' })
        return publishVersion({
          id,
          baseVersion: current.version,
          html: source.html,
          author: actorOf({ req, body, url }),
          summary: `restored v${source.viewedVersion}`,
        })
      },
    }),
  ]
}
