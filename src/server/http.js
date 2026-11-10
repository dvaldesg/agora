import { EditError } from '../edits.js'
import { ConflictError, NotFoundError } from '../store.js'

const MAX_BODY = 20 * 1024 * 1024

export const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export class HttpError extends Error {
  constructor({ status, message }) {
    super(message)
    this.status = status
  }
}

export const SCOPES = Object.freeze({ open: 'open', artifact: 'artifact', comment: 'comment', filtered: 'filtered' })

export const route = ({ method, path, handler, scope }) => ({ method, path, handler, scope })

export const FULL_ACCESS = Object.freeze({ scope: 'full' })

export const artifactAccess = ({ artifactId }) => Object.freeze({ scope: 'artifact', artifactId })

export const isScoped = ({ access }) => access.scope === 'artifact'

export const created = ({ data }) => ({ status: 201, data })

export const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError({ status: 413, message: 'body too large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError({ status: 400, message: 'invalid JSON body' }))
      }
    })
    req.on('error', reject)
  })

export const sendJson = ({ res, status = 200, data }) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

export const sendText = ({ res, status = 200, type, body }) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

export const statusOf = ({ error }) => {
  if (error instanceof HttpError) return error.status
  if (error instanceof NotFoundError) return 404
  if (error instanceof ConflictError) return 409
  if (error instanceof EditError) return 422
  return 500
}

export const parseCookies = ({ header }) =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key]) => key),
  )
