import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, LOG_FILE } from './config.js'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agora.js')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class ApiError extends Error {
  constructor({ status, data }) {
    super(data?.error ?? `HTTP ${status}`)
    this.status = status
    this.data = data
  }
}

const parseFrames = ({ buffer }) => {
  const frames = buffer.split('\n\n')
  const rest = frames.pop()
  const messages = frames
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)))
  return { messages, rest }
}

export function createClient({ baseUrl, actor }) {
  const request = async ({ method = 'GET', path, body }) => {
    const headers = { 'x-agora-actor': actor }
    if (body) headers['content-type'] = 'application/json'
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError({ status: res.status, data })
    return data
  }

  const isUp = async () => {
    try {
      await request({ path: '/api/health' })
      return true
    } catch {
      return false
    }
  }

  const ensureDaemon = async () => {
    if (await isUp()) return
    mkdirSync(DATA_DIR, { recursive: true })
    const log = openSync(LOG_FILE, 'a')
    spawn(process.execPath, [BIN, 'daemon'], { detached: true, stdio: ['ignore', log, log] }).unref()
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(150)
      if (await isUp()) return
    }
    throw new Error(`agora daemon did not start, check ${LOG_FILE}`)
  }

  const joinPresence = ({ kind }) => {
    let connId = null
    let artifactId = null

    const sendFocus = async () => {
      if (!connId) return
      await request({ method: 'POST', path: `/api/presence/${connId}`, body: { artifactId } }).catch(() => {})
    }

    const connect = async () => {
      while (true) {
        try {
          const query = new URLSearchParams({ name: actor, kind })
          const res = await fetch(`${baseUrl}/api/stream?${query}`)
          const decoder = new TextDecoder()
          let buffer = ''
          for await (const chunk of res.body) {
            const parsed = parseFrames({ buffer: buffer + decoder.decode(chunk, { stream: true }) })
            buffer = parsed.rest
            const hello = parsed.messages.find((message) => message.type === 'hello')
            if (hello) {
              connId = hello.connId
              await sendFocus()
            }
          }
        } catch {}
        connId = null
        await sleep(2000)
      }
    }

    connect()

    return {
      focus: async ({ artifactId: next }) => {
        if (next === artifactId) return
        artifactId = next
        await sendFocus()
      },
    }
  }

  return { request, isUp, ensureDaemon, joinPresence, baseUrl, actor }
}
