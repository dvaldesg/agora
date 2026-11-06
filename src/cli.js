import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { BASE_URL, DATA_DIR, DB_FILE, MAX_VERSIONS, PORT, TOKEN_FILE } from './config.js'
import { createClient } from './client.js'

export const USAGE = `AGORA · shared live HTML artifacts for humans and any LLM

Setup
  agora init [--clients claude,codex,gemini,cursor] [--service] [--yes] [--dry-run] [--json]
             [--no-mcp] [--no-skills] [--no-link]      One-step setup (alias: agora setup)
  agora doctor [--json]                                 Check what is installed and running
  agora uninstall [--purge] [--yes] [--dry-run]          Undo init (--purge also deletes your artifacts)
  agora skills [--clients …]                            (Re)install only the /agora skill

Hub
  agora daemon [--lan] [--port N]                       Run the hub in the foreground
  agora stop                                            Stop a running hub
  agora open [artifactId]                               Open the web UI
  agora status                                          Hub health and who is online
  agora push <file.html> [--title T] [--id ID] [--as NAME]

Agents
  agora mcp --as <name>                                 MCP server (stdio) for any MCP client
  agora listen --as <name> [--exec codex | --exec "cmd {prompt}"] [--all] [--artifact ID] [--json] [-- codex args]
  agora hook add --as <name> --url <url> | agora hook list | agora hook rm <id>
`

const readToken = () => {
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim()
  const token = randomBytes(16).toString('hex')
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
  return token
}

const requireName = ({ values }) => {
  if (!values.as) throw new Error('--as <name> is required (e.g. claude, codex, gemini)')
  return values.as.toLowerCase()
}

const cliClient = ({ actor = 'cli' } = {}) => createClient({ baseUrl: BASE_URL, actor })

const parseClients = ({ values }) =>
  values.clients
    ?.split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean)

const setupOptions = ({ values }) => ({
  clients: parseClients({ values }),
  yes: values.yes,
  dryRun: values['dry-run'],
  service: values.service,
  mcp: values.mcp !== false,
  skills: values.skills !== false,
  link: values.link !== false,
  purge: values.purge,
})

const withReport = async ({ values, task }) => {
  const log = values.json ? () => {} : (line) => console.log(line)
  const result = await task({ log })
  if (values.json) console.log(JSON.stringify(result, null, 2))
  if (['failed', 'cancelled'].includes(result.status) || result.healthy === false) process.exitCode = 1
}

const setup = async ({ values }) => {
  const { runInit } = await import('./setup/index.js')
  await withReport({ values, task: ({ log }) => runInit({ options: setupOptions({ values }), log }) })
}

const hookCommands = {
  add: async ({ values }) => {
    if (!values.url) throw new Error('--url is required')
    const client = cliClient()
    await client.ensureDaemon()
    const hook = await client.request({ method: 'POST', path: '/api/hooks', body: { name: requireName({ values }), url: values.url } })
    console.log(`${hook.id} · events for @${hook.name} → ${hook.url}`)
  },
  list: async () => {
    const { hooks } = await cliClient().request({ path: '/api/hooks' })
    console.log(hooks.length ? hooks.map((hook) => `${hook.id} · @${hook.name} → ${hook.url}`).join('\n') : 'no hooks')
  },
  rm: async ({ positionals: [id] }) => {
    if (!id) throw new Error('usage: agora hook rm <id>')
    await cliClient().request({ method: 'DELETE', path: `/api/hooks/${id}` })
    console.log(`removed ${id}`)
  },
}

const publishFile = async ({ client, values, html, file }) => {
  if (!values.id) {
    return client.request({ method: 'POST', path: '/api/artifacts', body: { title: values.title ?? basename(file, '.html'), html } })
  }
  const { versions } = await client.request({ path: `/api/artifacts/${values.id}/versions` })
  return client.request({
    method: 'PUT',
    path: `/api/artifacts/${values.id}`,
    body: { baseVersion: versions[0].version, html, summary: values.summary ?? `pushed ${basename(file)}`, title: values.title },
  })
}

export const commands = {
  init: setup,
  setup,

  skills: async ({ values }) => {
    const { runInit } = await import('./setup/index.js')
    const options = { ...setupOptions({ values }), mcp: false, link: false, hub: false, yes: true }
    await withReport({ values, task: ({ log }) => runInit({ options, log }) })
  },

  doctor: async ({ values }) => {
    const { runDoctor } = await import('./setup/index.js')
    await withReport({ values, task: ({ log }) => runDoctor({ log }) })
  },

  uninstall: async ({ values }) => {
    const { runUninstall } = await import('./setup/index.js')
    await withReport({ values, task: ({ log }) => runUninstall({ options: setupOptions({ values }), log }) })
  },

  daemon: async ({ values }) => {
    const { openStore } = await import('./store.js')
    const { startServer } = await import('./server/index.js')
    mkdirSync(DATA_DIR, { recursive: true })
    const port = Number(values.port ?? PORT)
    const store = openStore({ file: DB_FILE, maxVersions: MAX_VERSIONS })
    const { share } = await startServer({ store, port, lan: Boolean(values.lan), token: values.lan ? readToken() : null, maxVersions: MAX_VERSIONS })
    console.log(`agora hub on ${share.local} · keeping ${MAX_VERSIONS} versions per artifact`)
    if (share.lan) console.log(`shared on your network: ${share.lan}`)
  },

  stop: async () => {
    const { stopRunningHub } = await import('./setup/index.js')
    await stopRunningHub()
    console.log('hub stopped (a background service will restart it; use `agora uninstall` to remove the service)')
  },

  open: async ({ positionals: [id] }) => {
    const client = cliClient()
    await client.ensureDaemon()
    const url = `${BASE_URL}${id ? `/a/${id}` : '/'}`
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], (error) => error && console.log(url))
  },

  status: async () => {
    const client = cliClient()
    if (!(await client.isUp())) {
      console.log(`hub down at ${BASE_URL} (start it with \`agora daemon\` or \`agora init\`)`)
      process.exitCode = 1
      return
    }
    const [health, { peers }, { artifacts }] = await Promise.all([
      client.request({ path: '/api/health' }),
      client.request({ path: '/api/presence' }),
      client.request({ path: '/api/artifacts' }),
    ])
    console.log(`hub up at ${BASE_URL} · ${artifacts.length} artifacts · event ${health.seq}${health.lan ? ' · LAN on' : ''}`)
    peers.forEach((peer) => console.log(`  ${peer.kind === 'agent' ? 'agent' : 'human'}  ${peer.name}${peer.artifactId ? ` on ${peer.artifactId}` : ''}`))
  },

  push: async ({ values, positionals: [file] }) => {
    if (!file) throw new Error('usage: agora push <file.html> [--title T] [--id ID]')
    const client = cliClient({ actor: values.as ?? process.env.USER ?? 'cli' })
    await client.ensureDaemon()
    const artifact = await publishFile({ client, values, file, html: await readFile(resolve(file), 'utf8') })
    console.log(`${artifact.id} v${artifact.version} · ${BASE_URL}/a/${artifact.id}`)
  },

  rm: async ({ positionals: [id] }) => {
    if (!id) throw new Error('usage: agora rm <artifactId>')
    await cliClient().request({ method: 'DELETE', path: `/api/artifacts/${id}` })
    console.log(`deleted ${id} with its versions, comments, messages and state`)
  },

  mcp: async ({ values }) => {
    const { runMcp } = await import('./mcp.js')
    await runMcp({ client: createClient({ baseUrl: BASE_URL, actor: requireName({ values }) }) })
  },

  listen: async ({ values, extraArgs }) => {
    const { listen } = await import('./listen.js')
    await listen({
      client: createClient({ baseUrl: BASE_URL, actor: requireName({ values }) }),
      all: values.all,
      artifactId: values.artifact,
      since: values.since ? Number(values.since) : undefined,
      json: values.json,
      exec: values.exec,
      cwd: process.cwd(),
      extraArgs,
    })
  },

  hook: async ({ values, positionals: [action, ...rest] }) => {
    const command = hookCommands[action]
    if (!command) throw new Error('usage: agora hook add|list|rm')
    await command({ values, positionals: rest })
  },
}

export const OPTIONS = {
  as: { type: 'string' },
  port: { type: 'string' },
  lan: { type: 'boolean' },
  all: { type: 'boolean' },
  artifact: { type: 'string' },
  since: { type: 'string' },
  json: { type: 'boolean' },
  exec: { type: 'string' },
  title: { type: 'string' },
  id: { type: 'string' },
  summary: { type: 'string' },
  url: { type: 'string' },
  clients: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  'dry-run': { type: 'boolean' },
  service: { type: 'boolean' },
  mcp: { type: 'boolean' },
  skills: { type: 'boolean' },
  link: { type: 'boolean' },
  purge: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
}
