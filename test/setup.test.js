import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'agora-home-'))
const originalHome = process.env.HOME
let clients
let skills

before(async () => {
  process.env.HOME = sandbox
  clients = await import('../src/setup/clients.js')
  skills = await import('../src/setup/skills.js')
})

after(() => {
  process.env.HOME = originalHome
  rmSync(sandbox, { recursive: true, force: true })
})

const client = ({ id }) => clients.CLIENTS.find((candidate) => candidate.id === id)

test('json MCP configs are merged, detected and removed without touching other servers', async () => {
  const cursor = client({ id: 'cursor' })
  const file = join(sandbox, '.cursor', 'mcp.json')
  mkdirSync(join(sandbox, '.cursor'), { recursive: true })
  writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }))

  assert.equal(await cursor.mcp.isRegistered(), false)
  await cursor.mcp.register({ name: 'cursor' })
  const config = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(Object.keys(config.mcpServers).sort(), ['agora', 'other'])
  assert.deepEqual(config.mcpServers.agora.args.slice(-3), ['mcp', '--as', 'cursor'])
  assert.equal(await cursor.mcp.isRegistered(), true)
  assert.ok(existsSync(`${file}.agora-backup`))

  await cursor.mcp.unregister()
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers), ['other'])
})

test('empty json config files are treated as empty objects', async () => {
  const gemini = client({ id: 'gemini' })
  const file = join(sandbox, '.gemini', 'settings.json')
  mkdirSync(join(sandbox, '.gemini'), { recursive: true })
  writeFileSync(file, '')
  await gemini.mcp.register({ name: 'gemini' })
  assert.equal(await gemini.mcp.isRegistered(), true)
})

test('skills render per client and are detected as installed', async () => {
  const claude = client({ id: 'claude' })
  await skills.installSkill({ client: claude })
  const markdown = readFileSync(claude.skill.path, 'utf8')
  assert.match(markdown, /^---\nname: agora\n/)
  assert.match(markdown, /connected as \*\*claude\*\*/)
  assert.ok(!markdown.includes('{{AGORA_BIN}}'))
  assert.equal(await skills.isSkillInstalled({ client: claude }), true)

  const gemini = client({ id: 'gemini' })
  await skills.installSkill({ client: gemini })
  const toml = readFileSync(gemini.skill.path, 'utf8')
  assert.match(toml, /^description = "Create, edit, review and share/)
  assert.match(toml, /Request: \{\{args\}\}/)

  await skills.removeSkill({ client: claude })
  assert.equal(existsSync(claude.skill.path), false)
})

test('unknown clients are rejected with the list of known ones', async () => {
  await assert.rejects(() => clients.selectClients({ requested: ['nope'] }), /Known: claude, codex, gemini, cursor/)
})
