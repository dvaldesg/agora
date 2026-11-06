import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { SESSIONS_DIR } from './config.js'
import { describeEvent } from './format.js'
import { sleep } from './client.js'
import { ACTIONABLE_TYPES } from './relevance.js'

const hasActionable = ({ events }) => events.some((event) => ACTIONABLE_TYPES.has(event.type))

const promptFor = ({ agent, events }) => `You are ${agent}, connected to Agora (shared live HTML artifacts watched by humans and other agents).

New events:
${events.map((event) => `- ${describeEvent({ event })}`).join('\n')}

Handle what is for you using the agora MCP tools:
- Read the artifact (agora_read; use sinceVersion for just the diff if you already know it).
- Claim a comment (agora_set_comment_status claimed) before working on it; skip it if someone else claimed it.
- Edit with agora_update (small old_str/new_str edits, correct baseVersion, one-line summary).
- Reply in the comment thread (agora_comment with parentId) saying what you changed, then resolve it.
- Answer messages with agora_message. Mention people or agents with @name.
If nothing needs action from you, do nothing. Do not reply to acknowledgements or thanks, and only message another agent when they need to act; otherwise agents wake each other up in a loop.`

const shellQuote = ({ value }) => `'${value.replace(/'/g, `'\\''`)}'`

const CODEX_AUTO_APPROVE = 'mcp_servers.agora.default_tools_approval_mode="approve"'

const codexPreset = ({ agent, extraArgs }) => {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const sessionFile = join(SESSIONS_DIR, `${agent}.json`)
  const readSession = () => {
    try {
      return JSON.parse(readFileSync(sessionFile, 'utf8')).sessionId
    } catch {
      return null
    }
  }
  return {
    describe: () => {
      const sessionId = readSession()
      return sessionId ? `codex (session ${sessionId})` : 'codex (new session)'
    },
    command: ({ prompt }) => {
      const sessionId = readSession()
      const flags = ['--json', '--skip-git-repo-check', '-c', CODEX_AUTO_APPROVE, ...extraArgs]
      return { file: 'codex', args: sessionId ? ['exec', 'resume', ...flags, sessionId, prompt] : ['exec', ...flags, prompt], stdin: null }
    },
    onLine: ({ line }) => {
      try {
        const parsed = JSON.parse(line)
        const sessionId = parsed.thread_id ?? parsed.session_id ?? parsed.msg?.session_id
        if (sessionId) writeFileSync(sessionFile, JSON.stringify({ sessionId }))
      } catch {}
    },
  }
}

const templatePreset = ({ template }) => ({
  describe: () => template,
  command: ({ prompt }) => {
    const usesPlaceholder = template.includes('{prompt}')
    const script = usesPlaceholder ? template.replaceAll('{prompt}', shellQuote({ value: prompt })) : template
    return { file: 'sh', args: ['-c', script], stdin: usesPlaceholder ? null : prompt }
  },
  onLine: () => {},
})

function createRunner({ agent, cwd, preset }) {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const logFile = join(SESSIONS_DIR, `${agent}.log`)
  let pending = []
  let running = false

  const run = () => {
    running = true
    const events = pending
    pending = []
    const prompt = promptFor({ agent, events })
    const { file, args, stdin } = preset.command({ prompt })
    process.stderr.write(`agora: waking ${preset.describe()} for ${events.length} event(s)\n`)
    const child = spawn(file, args, {
      cwd,
      stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, AGORA_AGENT: agent, AGORA_PROMPT: prompt },
    })
    if (stdin !== null) child.stdin.end(stdin)
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      appendFileSync(logFile, chunk)
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop()
      lines.forEach((line) => preset.onLine({ line }))
    })
    child.stderr.on('data', (chunk) => appendFileSync(logFile, chunk))
    child.on('error', (error) => process.stderr.write(`agora: could not start ${file}: ${error.message}\n`))
    child.on('close', (code) => {
      process.stderr.write(`agora: run finished with code ${code}, log ${logFile}\n`)
      running = false
      if (hasActionable({ events: pending })) run()
    })
  }

  return {
    push: ({ events }) => {
      pending.push(...events)
      if (!running && hasActionable({ events: pending })) run()
    },
  }
}

const presetFor = ({ exec, agent, extraArgs }) => {
  if (!exec) return null
  if (exec === 'codex') return codexPreset({ agent, extraArgs })
  return templatePreset({ template: exec })
}

export async function listen({ client, all, artifactId, since, json, exec, cwd, extraArgs }) {
  await client.ensureDaemon()
  client.joinPresence({ kind: 'agent' })
  const agent = client.actor
  const preset = presetFor({ exec, agent, extraArgs })
  const runner = preset ? createRunner({ agent, cwd, preset }) : null
  let cursor = since ?? (await client.request({ path: '/api/health' })).seq
  process.stderr.write(`agora: ${agent} listening on ${client.baseUrl} from event ${cursor}${preset ? ` · exec: ${preset.describe()}` : ''}\n`)

  while (true) {
    try {
      const query = new URLSearchParams({ since: String(cursor), agent, timeout: '50000' })
      if (all) query.set('all', '1')
      if (artifactId) query.set('artifact', artifactId)
      const result = await client.request({ path: `/api/events?${query}` })
      cursor = result.cursor
      result.events.forEach((event) => console.log(json ? JSON.stringify(event) : describeEvent({ event })))
      runner?.push({ events: result.events })
    } catch (error) {
      process.stderr.write(`agora: ${error.message}, retrying\n`)
      await sleep(2000)
      await client.ensureDaemon().catch(() => {})
    }
  }
}
