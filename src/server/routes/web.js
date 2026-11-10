import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { HttpError, SCOPES, route, sendText } from '../http.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const injectOverlay = ({ html, overlay }) => {
  const script = `<script data-agora-overlay>${overlay}</script>`
  const insertAfter = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html)
  if (!insertAfter) return script + html
  const position = insertAfter.index + insertAfter[0].length
  return html.slice(0, position) + script + html.slice(position)
}

export function webRoutes({ store, webDir, shareLinks }) {
  const readWeb = ({ file }) => readFileSync(join(webDir, file), 'utf8')
  const overlay = readWeb({ file: 'overlay.js' })

  const staticFile = ({ path }) => {
    const resolved = normalize(join(webDir, path))
    const type = MIME[extname(resolved)]
    if (!resolved.startsWith(webDir + sep) || !type || resolved.endsWith(`${sep}overlay.js`)) throw new HttpError({ status: 404, message: 'not found' })
    return { type, body: readFileSync(resolved, 'utf8') }
  }

  return [
    route({ method: 'GET', path: /^\/api\/share(?:\/([\w-]+))?$/, handler: ({ params: [id] }) => shareLinks({ id }) }),

    route({
      method: 'GET',
      path: /^\/raw\/([\w-]+)$/,
      scope: SCOPES.artifact,
      handler: ({ res, url, params: [id] }) => {
        const version = url.searchParams.get('v')
        const artifact = store.getArtifact({ id, version: version ? Number(version) : undefined })
        sendText({ res, type: MIME['.html'], body: injectOverlay({ html: artifact.html, overlay }) })
        return null
      },
    }),

    route({
      method: 'GET',
      path: /^\/(?:a\/[\w-]+)?$/,
      scope: SCOPES.open,
      handler: ({ res }) => {
        sendText({ res, type: MIME['.html'], body: readWeb({ file: 'index.html' }) })
        return null
      },
    }),

    route({
      method: 'GET',
      path: /^\/static\/([\w./-]+)$/,
      scope: SCOPES.open,
      handler: ({ res, params: [path] }) => {
        const { type, body } = staticFile({ path })
        sendText({ res, type, body })
        return null
      },
    }),
  ]
}
