import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/store.js'
import { startServer } from '../src/server/index.js'

const dir = mkdtempSync(join(tmpdir(), 'agora-test-'))
const port = 4800 + Math.floor(Math.random() * 100)
const base = `http://127.0.0.1:${port}`
let server

const call = async ({ path, method = 'GET', body, actor }) => {
  const headers = {}
  if (body) headers['content-type'] = 'application/json'
  if (actor) headers['x-agora-actor'] = actor
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const raw = await res.text()
  const isJson = res.headers.get('content-type')?.includes('json')
  return { status: res.status, data: isJson ? JSON.parse(raw) : null, text: raw }
}

const register = ({ name, kind = 'agent' }) => call({ path: '/api/participants', method: 'POST', body: { name, kind } })

const createArtifact = async ({ html = '<html><head></head><body><h1 id="t">Hola</h1><p>uno</p></body></html>', actor = 'claude' } = {}) =>
  (await call({ path: '/api/artifacts', method: 'POST', actor, body: { title: 'Demo', html } })).data

before(async () => {
  ;({ server } = await startServer({ store: openStore({ file: join(dir, 'db'), maxVersions: 3 }), port, lan: false, token: null }))
  await Promise.all(['claude', 'codex', 'gemini'].map((name) => register({ name })))
  await register({ name: 'diego', kind: 'human' })
})

after(() => {
  server.closeAllConnections()
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

test('artifact lifecycle, conflicts, comments and targeted events', async () => {
  const { data: health } = await call({ path: '/api/health' })
  const { id } = await createArtifact()

  const patched = await call({
    path: `/api/artifacts/${id}`,
    method: 'PUT',
    actor: 'codex',
    body: { baseVersion: 1, summary: 'texto', edits: [{ old_str: 'uno', new_str: 'dos' }] },
  })
  assert.equal(patched.data.version, 2)

  const conflict = await call({
    path: `/api/artifacts/${id}`,
    method: 'PUT',
    actor: 'claude',
    body: { baseVersion: 1, summary: 'x', edits: [{ old_str: 'Hola', new_str: 'Chao' }] },
  })
  assert.equal(conflict.status, 409)
  assert.match(conflict.data.diff, /\+.*<p>dos/)

  const ambiguous = await call({
    path: `/api/artifacts/${id}`,
    method: 'PUT',
    actor: 'claude',
    body: { baseVersion: 2, summary: 'x', edits: [{ old_str: 'h1', new_str: 'h2' }] },
  })
  assert.equal(ambiguous.status, 422)

  const comment = await call({
    path: `/api/artifacts/${id}/comments`,
    method: 'POST',
    body: { author: 'diego', body: '@codex cambia el título', anchor: { mode: 'element', targets: [{ selector: '#t', tag: 'h1', text: 'Hola' }] } },
  })
  assert.equal(comment.data.assignee, 'codex')
  assert.equal(comment.data.anchor.targets[0].tag, 'h1')

  const claimed = await call({ path: `/api/comments/${comment.data.id}/status`, method: 'POST', actor: 'codex', body: { status: 'claimed' } })
  assert.equal(claimed.data.claimedBy, 'codex')
  const stolen = await call({ path: `/api/comments/${comment.data.id}/status`, method: 'POST', actor: 'claude', body: { status: 'claimed' } })
  assert.equal(stolen.status, 409)

  await call({ path: `/api/artifacts/${id}/comments`, method: 'POST', actor: 'codex', body: { body: 'listo', parentId: comment.data.id } })

  const forCodex = await call({ path: `/api/events?since=${health.seq}&agent=codex&timeout=100` })
  assert.deepEqual(
    forCodex.data.events.map((event) => event.type),
    ['artifact.created', 'comment.created'],
  )

  const forClaude = await call({ path: `/api/events?since=${health.seq}&agent=claude&timeout=100` })
  assert.deepEqual(
    forClaude.data.events.map((event) => event.type),
    ['artifact.updated'],
  )

  const raw = await call({ path: `/raw/${id}` })
  assert.match(raw.text, /<head><script data-agora-overlay>/)
})

test('any registered participant can be @mentioned, unknown names cannot', async () => {
  const { id } = await createArtifact()
  const known = await call({ path: `/api/artifacts/${id}/comments`, method: 'POST', body: { author: 'diego', body: 'ojo @Gemini con esto' } })
  assert.equal(known.data.assignee, 'gemini')
  const unknown = await call({ path: `/api/artifacts/${id}/comments`, method: 'POST', body: { author: 'diego', body: 'hola @nadie' } })
  assert.equal(unknown.data.assignee, null)
  const { data } = await call({ path: '/api/participants' })
  assert.ok(data.participants.some((participant) => participant.name === 'gemini' && participant.kind === 'agent'))
})

test('area anchors keep every target', async () => {
  const { id } = await createArtifact()
  const targets = [
    { selector: 'body > h1', tag: 'h1', text: 'Hola' },
    { selector: 'body > p', tag: 'p', text: 'uno' },
  ]
  const { data } = await call({
    path: `/api/artifacts/${id}/comments`,
    method: 'POST',
    body: { author: 'diego', body: 'esta zona', anchor: { mode: 'area', targets, rect: { x: 0, y: 0, w: 300, h: 120 } } },
  })
  assert.equal(data.anchor.mode, 'area')
  assert.equal(data.anchor.targets.length, 2)
  assert.deepEqual(data.anchor.rect, { x: 0, y: 0, w: 300, h: 120 })
})

test('long poll wakes up on a new targeted message', async () => {
  const { data: health } = await call({ path: '/api/health' })
  const waiting = call({ path: `/api/events?since=${health.seq}&agent=claude&timeout=5000` })
  await new Promise((resolve) => setTimeout(resolve, 150))
  await call({ path: '/api/messages', method: 'POST', actor: 'codex', body: { to: 'Claude', body: '¿tomas tú el header?' } })
  const { data } = await waiting
  assert.equal(data.events.length, 1)
  assert.equal(data.events[0].type, 'message.sent')
  assert.equal(data.events[0].target, 'claude')
})

test('artifact state: shared and per-user scopes, quiet for agents', async () => {
  const { id } = await createArtifact()
  const { data: health } = await call({ path: '/api/health' })
  await call({ path: `/api/artifacts/${id}/state/votes`, method: 'PUT', body: { author: 'diego', value: { a: 2, b: 1 } } })
  await call({ path: `/api/artifacts/${id}/state/draft`, method: 'PUT', body: { author: 'diego', scope: 'user', value: 'mío' } })

  const shared = await call({ path: `/api/artifacts/${id}/state?key=votes&as=codex` })
  assert.deepEqual(shared.data.value, { a: 2, b: 1 })
  const mine = await call({ path: `/api/artifacts/${id}/state?scope=user&key=draft&as=diego` })
  assert.equal(mine.data.value, 'mío')
  const theirs = await call({ path: `/api/artifacts/${id}/state?scope=user&key=draft&as=codex` })
  assert.equal(theirs.data.value, null)

  const listed = await call({ path: `/api/artifacts/${id}/state?prefix=vo` })
  assert.deepEqual(
    listed.data.items.map((item) => item.key),
    ['votes'],
  )

  const removed = await call({ path: `/api/artifacts/${id}/state/votes`, method: 'DELETE', actor: 'diego' })
  assert.equal(removed.data.deleted, true)

  const forAgent = await call({ path: `/api/events?since=${health.seq}&agent=codex&timeout=100` })
  assert.ok(!forAgent.data.events.some((event) => event.type === 'state.changed'))
  const everything = await call({ path: `/api/events?since=${health.seq}&agent=codex&all=1&timeout=100` })
  assert.equal(everything.data.events.filter((event) => event.type === 'state.changed').length, 3)
})

test('versions are pruned to the max but keep v1 and versions with open comments, and can be restored', async () => {
  const { id } = await createArtifact({ html: '<p>v1</p>' })
  const publish = async ({ baseVersion }) =>
    call({
      path: `/api/artifacts/${id}`,
      method: 'PUT',
      actor: 'claude',
      body: { baseVersion, summary: `to ${baseVersion + 1}`, html: `<p>v${baseVersion + 1}</p>` },
    })
  await publish({ baseVersion: 1 })
  await call({ path: `/api/artifacts/${id}/comments`, method: 'POST', body: { author: 'diego', body: 'mira esto', version: 2 } })
  for (const baseVersion of [2, 3, 4, 5]) await publish({ baseVersion })

  const { data } = await call({ path: `/api/artifacts/${id}/versions` })
  assert.deepEqual(
    data.versions.map((entry) => entry.version),
    [6, 5, 4, 2, 1],
  )

  const restored = await call({ path: `/api/artifacts/${id}/restore`, method: 'POST', actor: 'diego', body: { version: 2 } })
  assert.equal(restored.data.version, 7)
  const latest = await call({ path: `/api/artifacts/${id}` })
  assert.equal(latest.data.html, '<p>v2</p>')
  assert.equal(latest.data.versionSummary, 'restored v2')

  const gone = await call({ path: `/api/artifacts/${id}?v=3` })
  assert.equal(gone.status, 404)
})

test('webhooks receive events addressed to their agent', async () => {
  const received = []
  const sink = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push(JSON.parse(body))
      res.end('ok')
    })
  })
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve))
  const hook = await call({ path: '/api/hooks', method: 'POST', body: { name: 'mybot', url: `http://127.0.0.1:${sink.address().port}/agora` } })
  assert.equal(hook.status, 201)

  const { id } = await createArtifact()
  await call({ path: `/api/artifacts/${id}/comments`, method: 'POST', body: { author: 'diego', body: '@mybot revisa' } })
  await call({ path: `/api/artifacts/${id}/comments`, method: 'POST', body: { author: 'diego', body: '@codex no es para el bot' } })
  await new Promise((resolve) => setTimeout(resolve, 300))

  const comments = received.filter((payload) => payload.event.type === 'comment.created')
  assert.equal(comments.length, 1)
  assert.equal(comments[0].agent, 'mybot')
  assert.match(comments[0].text, /@mybot/)

  await call({ path: `/api/hooks/${hook.data.id}`, method: 'DELETE' })
  sink.close()
})

test('deleting an artifact removes everything attached to it and announces it', async () => {
  const { id } = await createArtifact()
  await call({ path: `/api/artifacts/${id}/comments`, method: 'POST', body: { author: 'diego', body: 'raíz' } })
  await call({ path: `/api/artifacts/${id}/state/k`, method: 'PUT', body: { author: 'diego', value: 1 } })
  const { data: health } = await call({ path: '/api/health' })

  const removed = await call({ path: `/api/artifacts/${id}`, method: 'DELETE', actor: 'diego' })
  assert.equal(removed.data.deleted, true)
  assert.equal((await call({ path: `/api/artifacts/${id}` })).status, 404)
  assert.equal((await call({ path: `/api/artifacts/${id}`, method: 'DELETE' })).status, 404)

  const events = await call({ path: `/api/events?since=${health.seq}&agent=codex&timeout=100` })
  assert.deepEqual(
    events.data.events.map((event) => event.type),
    ['artifact.deleted'],
  )
})
