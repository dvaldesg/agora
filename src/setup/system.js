import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BIN_PATH = join(ROOT, 'bin', 'agora.js')
export const SKILL_TEMPLATE = join(ROOT, 'skills', 'agora', 'SKILL.md')
export const MIN_NODE = [22, 13]

export const home = (...parts) => join(homedir(), ...parts)

export const run = async ({ file, args = [], cwd = ROOT }) => {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { cwd, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 })
    return { ok: true, stdout, stderr }
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr || error.message }
  }
}

export const runOrThrow = async ({ file, args, cwd }) => {
  const result = await run({ file, args, cwd })
  if (!result.ok) throw new Error(`${file} ${args.join(' ')} failed: ${result.stderr.trim().split('\n').at(-1)}`)
  return result
}

export const hasCommand = async ({ name }) => (await run({ file: 'which', args: [name] })).ok

export const readJsonFile = async ({ file }) => {
  if (!existsSync(file)) return {}
  const text = await readFile(file, 'utf8')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${file} is not valid JSON; fix it or edit it by hand`)
  }
}

const backupOnce = async ({ file }) => {
  const backup = `${file}.agora-backup`
  if (existsSync(file) && !existsSync(backup)) await copyFile(file, backup)
}

export const writeJsonFile = async ({ file, data }) => {
  await mkdir(dirname(file), { recursive: true })
  await backupOnce({ file })
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`)
}

export const nodeIsSupported = () => {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])
}

export const mcpLaunch = ({ name }) => ({ command: process.execPath, args: [BIN_PATH, 'mcp', '--as', name] })
