import { accessSync, constants, existsSync, realpathSync } from 'node:fs'
import { chmod, mkdir, rm, symlink } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { BASE_URL, DATA_DIR } from '../config.js'
import { createClient, sleep } from '../client.js'
import { CLIENTS, selectClients } from './clients.js'
import { serviceManager } from './service.js'
import { installSkill, isSkillInstalled, removeSkill } from './skills.js'
import { BIN_PATH, MIN_NODE, ROOT, hasCommand, home, nodeIsSupported, runOrThrow } from './system.js'

const DEPS_MARKER = join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json')
const PATH_CANDIDATES = [home('.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
const MARKS = { ok: '✓', done: '✓', planned: '→', failed: '✗', missing: '✗', skipped: '–' }

const hub = createClient({ baseUrl: BASE_URL, actor: 'setup' })

const isWritable = ({ dir }) => {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

const linkDir = () => {
  const onPath = new Set((process.env.PATH ?? '').split(delimiter))
  return PATH_CANDIDATES.find((dir) => onPath.has(dir) && existsSync(dir) && isWritable({ dir })) ?? null
}

const isExecutable = () => {
  try {
    accessSync(BIN_PATH, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const isLinked = ({ dir }) => {
  try {
    return realpathSync(join(dir, 'agora')) === realpathSync(BIN_PATH) && isExecutable()
  } catch {
    return false
  }
}

const installDependencies = async () => {
  const usePnpm = existsSync(join(ROOT, 'pnpm-lock.yaml')) && (await hasCommand({ name: 'pnpm' }))
  const [file, args] = usePnpm ? ['pnpm', ['install', '--prod', '--frozen-lockfile']] : ['npm', ['install', '--omit=dev', '--no-audit', '--no-fund']]
  await runOrThrow({ file, args, cwd: ROOT })
  return `${file} install`
}

const stopHub = async () => {
  if (!(await hub.isUp())) return
  await hub.request({ method: 'POST', path: '/api/shutdown' }).catch(() => {})
  for (let attempt = 0; attempt < 30 && (await hub.isUp()); attempt += 1) await sleep(100)
}

const waitForHub = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await hub.isUp()) return
    await sleep(150)
  }
  throw new Error('hub did not come up, check ~/.agora/daemon.log')
}

const pathStep = () => {
  const dir = linkDir()
  if (!dir) {
    return {
      title: 'Put `agora` on your PATH',
      check: async () => false,
      apply: async () => {
        throw new Error(`no writable directory on PATH; add this to your shell profile: alias agora="node ${BIN_PATH}"`)
      },
    }
  }
  return {
    title: `Put \`agora\` on your PATH (${join(dir, 'agora')})`,
    check: async () => isLinked({ dir }),
    apply: async () => {
      await chmod(BIN_PATH, 0o755)
      await rm(join(dir, 'agora'), { force: true })
      await symlink(BIN_PATH, join(dir, 'agora'))
    },
  }
}

const hubStep = ({ service }) => {
  if (!service) return { title: `Start the hub on ${BASE_URL}`, check: hub.isUp, apply: hub.ensureDaemon }
  const manager = serviceManager()
  if (!manager) {
    return {
      title: 'Run the hub as a background service',
      check: async () => false,
      apply: async () => {
        throw new Error(`no service manager for ${process.platform}; run \`agora daemon\` yourself`)
      },
    }
  }
  return {
    title: `Run the hub as a ${manager.name} (starts on login)`,
    check: manager.isInstalled,
    apply: async () => {
      await stopHub()
      await manager.install()
      await waitForHub()
    },
  }
}

const clientSteps = ({ client, mcp, skills }) => [
  mcp && {
    title: `Register the MCP server in ${client.label} as "${client.id}"`,
    preview: client.mcp.describe({ name: client.id }),
    check: client.mcp.isRegistered,
    apply: () => client.mcp.register({ name: client.id }),
  },
  skills && {
    title: `Install the /agora skill for ${client.label}`,
    preview: client.skill.path,
    check: () => isSkillInstalled({ client }),
    apply: () => installSkill({ client }),
  },
]

const buildSteps = ({ clients, options }) =>
  [
    { title: 'Install dependencies', check: async () => existsSync(DEPS_MARKER), apply: installDependencies },
    { title: `Create the data directory ${DATA_DIR}`, check: async () => existsSync(DATA_DIR), apply: () => mkdir(DATA_DIR, { recursive: true }) },
    options.link && pathStep(),
    options.hub !== false && hubStep({ service: options.service }),
    ...clients.flatMap((client) => clientSteps({ client, mcp: options.mcp, skills: options.skills })),
  ].filter(Boolean)

const evaluate = async ({ steps }) => {
  const evaluated = []
  for (const step of steps) evaluated.push({ ...step, done: await step.check().catch(() => false) })
  return evaluated
}

const confirm = async ({ question }) => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await prompt.question(`${question} [Y/n] `)).trim().toLowerCase()
  prompt.close()
  return answer === '' || answer === 'y' || answer === 'yes'
}

const applySteps = async ({ steps, log }) => {
  const results = []
  for (const step of steps) {
    if (step.done) {
      results.push({ title: step.title, status: 'ok' })
      continue
    }
    try {
      const detail = await step.apply()
      results.push({ title: step.title, status: 'done', detail: typeof detail === 'string' ? detail : undefined })
      log(`  ✓ ${step.title}`)
    } catch (error) {
      results.push({ title: step.title, status: 'failed', error: error.message })
      log(`  ✗ ${step.title}\n      ${error.message}`)
    }
  }
  return results
}

const nextSteps = ({ clients }) => [
  `Open the UI:      agora open   (${BASE_URL})`,
  'Restart your agent sessions so they load the MCP server and the /agora skill.',
  ...clients.map((client) => `Wake ${client.label.padEnd(12)} ${client.wake}`),
]

export const runInit = async ({ options, log }) => {
  if (!nodeIsSupported()) throw new Error(`Node ${MIN_NODE.join('.')}+ is required, found ${process.versions.node}`)
  const clients = await selectClients({ requested: options.clients })
  const steps = await evaluate({ steps: buildSteps({ clients, options }) })
  const pending = steps.filter((step) => !step.done)

  log(`AGORA setup · ${clients.length ? `clients: ${clients.map((client) => client.label).join(', ')}` : 'no agent clients detected'}\n`)
  steps.forEach((step) => log(`  ${step.done ? MARKS.ok : MARKS.planned} ${step.title}${!step.done && step.preview ? `\n      ${step.preview}` : ''}`))

  if (!pending.length) {
    log('\nEverything is already set up.')
    return { status: 'ok', clients: clients.map((client) => client.id), steps: steps.map(({ title }) => ({ title, status: 'ok' })) }
  }
  if (options.dryRun) {
    log('\nDry run: nothing changed.')
    return {
      status: 'planned',
      clients: clients.map((client) => client.id),
      steps: steps.map(({ title, done }) => ({ title, status: done ? 'ok' : 'planned' })),
    }
  }
  const interactive = process.stdin.isTTY && !options.yes
  if (interactive && !(await confirm({ question: `\nApply ${pending.length} change(s)?` }))) {
    log('Cancelled.')
    return { status: 'cancelled' }
  }

  log('')
  const results = await applySteps({ steps, log })
  const failed = results.filter((result) => result.status === 'failed')
  log(failed.length ? `\n${failed.length} step(s) failed.` : '\nDone.')
  log(`\n${nextSteps({ clients }).join('\n')}`)
  return { status: failed.length ? 'failed' : 'done', clients: clients.map((client) => client.id), steps: results }
}

export const runDoctor = async ({ log }) => {
  const manager = serviceManager()
  const dir = linkDir()
  const core = [
    { title: `Node ${process.versions.node} (needs ${MIN_NODE.join('.')}+)`, ok: nodeIsSupported(), required: true },
    { title: 'Dependencies installed', ok: existsSync(DEPS_MARKER), required: true },
    { title: `Hub reachable at ${BASE_URL}`, ok: await hub.isUp(), required: true },
    { title: '`agora` on PATH', ok: Boolean(dir) && isLinked({ dir }) },
    { title: manager ? `Background ${manager.name}` : 'Background service (unsupported here)', ok: manager ? await manager.isInstalled() : false },
  ]
  const clients = await Promise.all(
    CLIENTS.map(async (client) => ({
      client,
      detected: await client.detect(),
      mcp: await client.mcp.isRegistered().catch(() => false),
      skill: await isSkillInstalled({ client }),
    })),
  )
  core.forEach((check) => log(`  ${check.ok ? MARKS.ok : check.required ? MARKS.missing : MARKS.skipped} ${check.title}`))
  log('')
  clients.forEach(({ client, detected, mcp, skill }) => {
    const parts = detected ? [`MCP ${mcp ? MARKS.ok : MARKS.missing}`, `skill ${skill ? MARKS.ok : MARKS.missing}`] : ['not installed']
    log(`  ${client.label.padEnd(12)} ${parts.join('  ')}`)
  })
  const healthy = core.every((check) => check.ok || !check.required)
  log(healthy ? '\nHealthy.' : '\nRun `agora init` to fix what is missing.')
  return {
    healthy,
    core: core.map(({ title, ok }) => ({ title, ok })),
    clients: clients.map(({ client, detected, mcp, skill }) => ({ id: client.id, detected, mcp, skill })),
  }
}

export const runUninstall = async ({ options, log }) => {
  const manager = serviceManager()
  const dir = linkDir()
  const steps = [
    ...CLIENTS.flatMap((client) => [
      { title: `Remove the MCP server from ${client.label}`, check: client.mcp.isRegistered, apply: client.mcp.unregister },
      { title: `Remove the /agora skill from ${client.label}`, check: async () => existsSync(client.skill.path), apply: () => removeSkill({ client }) },
    ]),
    manager && { title: `Remove the ${manager.name}`, check: manager.isInstalled, apply: manager.uninstall },
    dir && { title: `Remove ${join(dir, 'agora')}`, check: async () => isLinked({ dir }), apply: () => rm(join(dir, 'agora'), { force: true }) },
    { title: 'Stop the hub', check: hub.isUp, apply: stopHub },
    options.purge && {
      title: `Delete all data in ${DATA_DIR}`,
      check: async () => existsSync(DATA_DIR),
      apply: () => rm(DATA_DIR, { recursive: true, force: true }),
    },
  ].filter(Boolean)

  const present = []
  for (const step of steps) if (await step.check().catch(() => false)) present.push(step)
  if (!present.length) {
    log('Nothing to remove.')
    return { status: 'ok', steps: [] }
  }
  present.forEach((step) => log(`  ${MARKS.planned} ${step.title}`))
  if (options.dryRun) return { status: 'planned', steps: present.map(({ title }) => ({ title, status: 'planned' })) }
  if (process.stdin.isTTY && !options.yes && !(await confirm({ question: `\nRemove ${present.length} item(s)?` }))) return { status: 'cancelled' }
  log('')
  const results = await applySteps({ steps: present.map((step) => ({ ...step, done: false })), log })
  if (!options.purge) log(`\nYour artifacts are still in ${DATA_DIR} (use --purge to delete them).`)
  return { status: 'done', steps: results }
}

export const stopRunningHub = stopHub
