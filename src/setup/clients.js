import { existsSync } from 'node:fs'
import { BIN_PATH, hasCommand, home, mcpLaunch, readJsonFile, run, runOrThrow, writeJsonFile } from './system.js'

const SERVER_NAME = 'agora'

const cliRegistry = ({ cli, addArgs, removeArgs }) => ({
  isRegistered: async () => {
    const result = await run({ file: cli, args: ['mcp', 'get', SERVER_NAME] })
    return result.ok && result.stdout.includes(BIN_PATH)
  },
  register: async ({ name }) => {
    await run({ file: cli, args: removeArgs })
    const { command, args } = mcpLaunch({ name })
    await runOrThrow({ file: cli, args: [...addArgs, '--', command, ...args] })
  },
  unregister: async () => {
    await run({ file: cli, args: removeArgs })
  },
  describe: ({ name }) => `${cli} ${addArgs.join(' ')} -- ${mcpLaunch({ name }).command} ${mcpLaunch({ name }).args.join(' ')}`,
})

const jsonRegistry = ({ file }) => ({
  isRegistered: async () => {
    const config = await readJsonFile({ file })
    return Boolean(config.mcpServers?.[SERVER_NAME]?.args?.includes(BIN_PATH))
  },
  register: async ({ name }) => {
    const config = await readJsonFile({ file })
    config.mcpServers = { ...config.mcpServers, [SERVER_NAME]: mcpLaunch({ name }) }
    await writeJsonFile({ file, data: config })
  },
  unregister: async () => {
    const config = await readJsonFile({ file })
    if (!config.mcpServers?.[SERVER_NAME]) return
    delete config.mcpServers[SERVER_NAME]
    await writeJsonFile({ file, data: config })
  },
  describe: () => `add "mcpServers.${SERVER_NAME}" to ${file}`,
})

const detectBy =
  ({ command, dir }) =>
  async () =>
    (await hasCommand({ name: command })) || existsSync(dir)

export const CLIENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    detect: detectBy({ command: 'claude', dir: home('.claude') }),
    mcp: cliRegistry({ cli: 'claude', addArgs: ['mcp', 'add', '--scope', 'user', SERVER_NAME], removeArgs: ['mcp', 'remove', SERVER_NAME, '--scope', 'user'] }),
    skill: { format: 'skill', path: home('.claude', 'skills', 'agora', 'SKILL.md') },
    wake: 'ask Claude Code to watch `agora listen --as claude` with the Monitor tool (or just run /agora listen)',
  },
  {
    id: 'codex',
    label: 'Codex',
    detect: detectBy({ command: 'codex', dir: home('.codex') }),
    mcp: cliRegistry({ cli: 'codex', addArgs: ['mcp', 'add', SERVER_NAME], removeArgs: ['mcp', 'remove', SERVER_NAME] }),
    skill: { format: 'skill', path: home('.codex', 'skills', 'agora', 'SKILL.md') },
    wake: 'agora listen --as codex --exec codex',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    detect: detectBy({ command: 'gemini', dir: home('.gemini') }),
    mcp: jsonRegistry({ file: home('.gemini', 'settings.json') }),
    skill: { format: 'gemini-command', path: home('.gemini', 'commands', 'agora.toml') },
    wake: "agora listen --as gemini --exec 'gemini -p {prompt}'",
  },
  {
    id: 'cursor',
    label: 'Cursor',
    detect: detectBy({ command: 'cursor-agent', dir: home('.cursor') }),
    mcp: jsonRegistry({ file: home('.cursor', 'mcp.json') }),
    skill: { format: 'skill', path: home('.cursor', 'skills', 'agora', 'SKILL.md') },
    wake: "agora listen --as cursor --exec 'cursor-agent -p {prompt}'",
  },
]

export const CLIENT_IDS = CLIENTS.map((client) => client.id)

export const selectClients = async ({ requested }) => {
  if (requested?.length) {
    const unknown = requested.filter((id) => !CLIENT_IDS.includes(id))
    if (unknown.length) throw new Error(`unknown client(s): ${unknown.join(', ')}. Known: ${CLIENT_IDS.join(', ')}`)
    return CLIENTS.filter((client) => requested.includes(client.id))
  }
  const detected = await Promise.all(CLIENTS.map(async (client) => ((await client.detect()) ? client : null)))
  return detected.filter(Boolean)
}
