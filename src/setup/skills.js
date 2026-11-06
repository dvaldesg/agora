import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BIN_PATH, SKILL_TEMPLATE } from './system.js'

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/

const renderTemplate = async ({ agent }) =>
  (await readFile(SKILL_TEMPLATE, 'utf8')).replaceAll('{{AGORA_BIN}}', `node ${BIN_PATH}`).replaceAll('{{AGENT}}', agent)

const descriptionOf = ({ markdown }) =>
  FRONTMATTER.exec(markdown)?.[1]
    .match(/^description:\s*(.+)$/m)?.[1]
    .trim() ?? 'Work with AGORA artifacts'

const toGeminiCommand = ({ markdown }) => {
  const body = markdown.replace(FRONTMATTER, '').replaceAll('"""', '\\"\\"\\"')
  return `description = ${JSON.stringify(descriptionOf({ markdown }))}\nprompt = """\n${body}\n\nRequest: {{args}}\n"""\n`
}

const renderFor = async ({ client }) => {
  const markdown = await renderTemplate({ agent: client.id })
  return client.skill.format === 'gemini-command' ? toGeminiCommand({ markdown }) : markdown
}

export const isSkillInstalled = async ({ client }) => {
  if (!existsSync(client.skill.path)) return false
  return (await readFile(client.skill.path, 'utf8')) === (await renderFor({ client }))
}

export const installSkill = async ({ client }) => {
  await mkdir(dirname(client.skill.path), { recursive: true })
  await writeFile(client.skill.path, await renderFor({ client }))
}

export const removeSkill = async ({ client }) => {
  const target = client.skill.format === 'skill' ? dirname(client.skill.path) : client.skill.path
  await rm(target, { recursive: true, force: true })
}
