import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ApiError } from './client.js'
import { describeEvent } from './format.js'

const { version: VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const instructionsFor = ({
  agent,
}) => `Agora is a shared live HTML artifact workspace. You are "${agent}". Humans and other agents (any LLM) view the same artifacts in a browser at the same time, leave comments anchored to elements or areas, and see every change live.

Workflow:
- Discover with agora_list. Read with agora_read; once you know a version, pass sinceVersion to get only a unified diff instead of the full HTML.
- Edit with agora_update using small edits (old_str/new_str, each unique) and the baseVersion you last read. A 409 conflict returns the diff of what changed meanwhile: rebase your edits on it and retry. Never overwrite blindly.
- For big rewrites, agora_read with file_path writes the HTML to disk; edit the file; agora_update with file_path pushes it.
- Comments are anchored to one element or an area (several elements). Each target has a CSS selector, tag and text snapshot taken at the comment's version. Claim a comment (agora_set_comment_status claimed) before working on it so others skip it, reply in its thread (agora_comment with parentId) saying what changed, then resolve it.
- Mention anyone with @name in comments and messages (agora_participants lists who exists). @all reaches everyone. Messages go through agora_message; read yours with agora_inbox.
- agora_wait blocks until something relevant to you happens (comments or messages for you, edits by others).
- Versions: agora_versions lists the kept history (oldest versions get pruned), agora_restore republishes an old version as a new one.
- Interactive artifacts can persist data. Inside the HTML use: await agora.state.get(key, { scope }), agora.state.set(key, value, { scope }), agora.state.delete(key, { scope }), agora.state.list({ scope, prefix }), agora.state.subscribe(({ key, value, scope, deleted, by }) => ...). scope is "shared" (everyone, default) or "user" (per viewer). agora.user is the viewer's name. Values are any JSON. Use this instead of localStorage for anything that matters. You can read and write the same data with agora_state.
- Always include a one-line summary on agora_update so viewers know what changed.`

const text = ({ value }) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

const failure = ({ error }) => {
  const details = error instanceof ApiError && error.data?.diff ? `\n\nChanges since your baseVersion:\n${error.data.diff}` : ''
  return { isError: true, content: [{ type: 'text', text: `${error.message}${details}` }] }
}

const safely = (handler) => async (input) => {
  try {
    return await handler(input)
  } catch (error) {
    return failure({ error })
  }
}

const editSchema = z.object({
  old_str: z.string().describe('Exact text currently in the HTML; must occur exactly once'),
  new_str: z.string().describe('Replacement text (empty string deletes)'),
})

export async function runMcp({ client }) {
  await client.ensureDaemon()
  const presence = client.joinPresence({ kind: 'agent' })
  const agent = client.actor
  let cursor = (await client.request({ path: '/api/health' })).seq

  const server = new McpServer({ name: 'agora', version: VERSION }, { instructions: instructionsFor({ agent }) })

  const focusOn = ({ id }) => presence.focus({ artifactId: id })

  server.registerTool(
    'agora_list',
    {
      description: 'List all Agora artifacts (id, title, version, last editor, open comments) and who is online.',
      inputSchema: {},
    },
    safely(async () => {
      const [{ artifacts }, { peers }] = await Promise.all([client.request({ path: '/api/artifacts' }), client.request({ path: '/api/presence' })])
      return text({ value: { artifacts, online: peers.map(({ name, kind, artifactId }) => ({ name, kind, artifactId })) } })
    }),
  )

  server.registerTool(
    'agora_create',
    {
      description: 'Create a new artifact from a full HTML document (inline or from a local file). Returns its id and URL.',
      inputSchema: {
        title: z.string().describe('Short name for the artifact'),
        html: z.string().optional().describe('Full HTML document'),
        file_path: z.string().optional().describe('Absolute path of a local .html file to upload instead of html'),
      },
    },
    safely(async ({ title, html, file_path: filePath }) => {
      const source = filePath ? await readFile(filePath, 'utf8') : html
      const artifact = await client.request({ method: 'POST', path: '/api/artifacts', body: { title, html: source } })
      await focusOn({ id: artifact.id })
      return text({ value: { ...artifact, url: `${client.baseUrl}/a/${artifact.id}` } })
    }),
  )

  server.registerTool(
    'agora_read',
    {
      description:
        'Read an artifact. Without sinceVersion returns metadata + full HTML. With sinceVersion returns only a unified diff from that version to the latest. With file_path writes the HTML to disk and returns metadata only.',
      inputSchema: {
        id: z.string(),
        sinceVersion: z.number().int().optional().describe('Return only the diff since this version'),
        version: z.number().int().optional().describe('Read a specific older version'),
        file_path: z.string().optional().describe('Absolute path to write the HTML to'),
      },
    },
    safely(async ({ id, sinceVersion, version, file_path: filePath }) => {
      await focusOn({ id })
      const query = new URLSearchParams()
      if (sinceVersion) query.set('since', String(sinceVersion))
      if (version) query.set('v', String(version))
      const result = await client.request({ path: `/api/artifacts/${id}?${query}` })
      if (sinceVersion) {
        const { diff, ...meta } = result
        const body = meta.version === sinceVersion ? 'No changes.' : diff
        return text({ value: `${JSON.stringify(meta)}\n\n${body}` })
      }
      const { html, ...meta } = result
      if (filePath) {
        await writeFile(filePath, html, 'utf8')
        return text({ value: { ...meta, writtenTo: filePath } })
      }
      return text({ value: `${JSON.stringify(meta)}\n\n${html}` })
    }),
  )

  server.registerTool(
    'agora_update',
    {
      description:
        'Publish a new version of an artifact. Prefer edits (old_str/new_str pairs). Or send full html, or file_path to push a local file. baseVersion must be the version you last read; on conflict you get the diff to rebase on.',
      inputSchema: {
        id: z.string(),
        baseVersion: z.number().int(),
        summary: z.string().describe('One line describing the change, shown to viewers'),
        edits: z.array(editSchema).optional(),
        html: z.string().optional(),
        file_path: z.string().optional(),
        title: z.string().optional().describe('Rename the artifact'),
      },
    },
    safely(async ({ id, baseVersion, summary, edits, html, file_path: filePath, title }) => {
      await focusOn({ id })
      const source = filePath ? await readFile(filePath, 'utf8') : html
      const body = { baseVersion, summary, title, ...(edits?.length ? { edits } : { html: source }) }
      return text({ value: await client.request({ method: 'PUT', path: `/api/artifacts/${id}`, body }) })
    }),
  )

  server.registerTool(
    'agora_versions',
    {
      description: 'List the kept version history of an artifact (newest first) with author and summary.',
      inputSchema: { id: z.string() },
    },
    safely(async ({ id }) => text({ value: await client.request({ path: `/api/artifacts/${id}/versions` }) })),
  )

  server.registerTool(
    'agora_restore',
    {
      description: 'Republish an older version as the new latest version (history is kept).',
      inputSchema: { id: z.string(), version: z.number().int() },
    },
    safely(async ({ id, version }) => {
      await focusOn({ id })
      return text({ value: await client.request({ method: 'POST', path: `/api/artifacts/${id}/restore`, body: { version } }) })
    }),
  )

  server.registerTool(
    'agora_comments',
    {
      description: 'List comment threads on an artifact (top-level comments with replies, anchors, version and status).',
      inputSchema: {
        id: z.string(),
        status: z.enum(['open', 'claimed', 'resolved']).optional(),
      },
    },
    safely(async ({ id, status }) => {
      await focusOn({ id })
      const query = status ? `?status=${status}` : ''
      return text({ value: await client.request({ path: `/api/artifacts/${id}/comments${query}` }) })
    }),
  )

  server.registerTool(
    'agora_comment',
    {
      description:
        'Add a comment to an artifact, or reply in a thread with parentId. Mention @name (or set assignee) to hand work to someone. anchorSelectors anchors it to one element, or to an area when you pass several.',
      inputSchema: {
        id: z.string().describe('Artifact id'),
        body: z.string(),
        parentId: z.string().optional().describe('Thread to reply in'),
        assignee: z.string().optional(),
        anchorSelectors: z.array(z.string()).optional().describe('CSS selectors of the elements the comment is about'),
      },
    },
    safely(async ({ id, body, parentId, assignee, anchorSelectors }) => {
      const anchor = anchorSelectors?.length
        ? { mode: anchorSelectors.length > 1 ? 'area' : 'element', targets: anchorSelectors.map((selector) => ({ selector })) }
        : undefined
      return text({
        value: await client.request({ method: 'POST', path: `/api/artifacts/${id}/comments`, body: { body, parentId, assignee, anchor } }),
      })
    }),
  )

  server.registerTool(
    'agora_set_comment_status',
    {
      description: 'Claim a comment before working on it, resolve it when done, or reopen it.',
      inputSchema: {
        commentId: z.string(),
        status: z.enum(['claimed', 'resolved', 'open']),
      },
    },
    safely(async ({ commentId, status }) =>
      text({ value: await client.request({ method: 'POST', path: `/api/comments/${commentId}/status`, body: { status } }) }),
    ),
  )

  server.registerTool(
    'agora_state',
    {
      description:
        'Read or write the persisted data of an interactive artifact (the same store its page uses via agora.state). scope "shared" is everyone\'s data, "user" is yours.',
      inputSchema: {
        id: z.string().describe('Artifact id'),
        action: z.enum(['list', 'get', 'set', 'delete']),
        key: z.string().optional(),
        value: z.unknown().optional().describe('Any JSON value, for set'),
        scope: z.enum(['shared', 'user']).optional(),
        prefix: z.string().optional().describe('Filter keys for list'),
      },
    },
    safely(async ({ id, action, key, value, scope = 'shared', prefix = '' }) => {
      const base = `/api/artifacts/${id}/state`
      if (action !== 'list' && !key) throw new Error('key is required')
      const encoded = encodeURIComponent(key ?? '')
      const requests = {
        list: () => client.request({ path: `${base}?scope=${scope}&prefix=${encodeURIComponent(prefix)}` }),
        get: () => client.request({ path: `${base}?scope=${scope}&key=${encoded}` }),
        set: () => client.request({ method: 'PUT', path: `${base}/${encoded}`, body: { value: value ?? null, scope } }),
        delete: () => client.request({ method: 'DELETE', path: `${base}/${encoded}?scope=${scope}` }),
      }
      return text({ value: await requests[action]() })
    }),
  )

  server.registerTool(
    'agora_message',
    {
      description: 'Send a direct message to any participant (agent or person) or "all". Optionally scoped to an artifact.',
      inputSchema: {
        to: z.string().describe('A participant name or "all"'),
        body: z.string(),
        artifactId: z.string().optional(),
      },
    },
    safely(async ({ to, body, artifactId }) =>
      text({ value: await client.request({ method: 'POST', path: '/api/messages', body: { to, body, artifactId } }) }),
    ),
  )

  server.registerTool(
    'agora_inbox',
    {
      description: `Messages sent to you (${agent}), to "all", or by you, oldest first.`,
      inputSchema: { artifactId: z.string().optional() },
    },
    safely(async ({ artifactId }) => {
      const query = new URLSearchParams({ participant: agent })
      if (artifactId) query.set('artifact', artifactId)
      return text({ value: await client.request({ path: `/api/messages?${query}` }) })
    }),
  )

  server.registerTool(
    'agora_wait',
    {
      description:
        'Block until events relevant to you happen (comments or messages for you, edits by others), or until the timeout. Remembers your cursor between calls.',
      inputSchema: {
        timeoutSeconds: z.number().int().min(1).max(55).optional(),
        artifactId: z.string().optional(),
        all: z.boolean().optional().describe('Include events addressed to others and state changes'),
        since: z.number().int().optional().describe('Event sequence to start after (defaults to your last cursor)'),
      },
    },
    safely(async ({ timeoutSeconds = 50, artifactId, all, since }) => {
      const query = new URLSearchParams({ since: String(since ?? cursor), agent, timeout: String(timeoutSeconds * 1000) })
      if (artifactId) query.set('artifact', artifactId)
      if (all) query.set('all', '1')
      const result = await client.request({ path: `/api/events?${query}` })
      cursor = result.cursor
      const lines = result.events.map((event) => describeEvent({ event }))
      return text({ value: lines.length ? `${lines.join('\n')}\n\ncursor: ${cursor}` : `No new events. cursor: ${cursor}` })
    }),
  )

  server.registerTool(
    'agora_participants',
    {
      description: 'Everyone who has ever connected (agents and people) with whether they are online now. Use these names for @mentions.',
      inputSchema: {},
    },
    safely(async () => {
      const [{ participants }, { peers }] = await Promise.all([client.request({ path: '/api/participants' }), client.request({ path: '/api/presence' })])
      return text({ value: { participants, connections: peers.map(({ name, kind, artifactId }) => ({ name, kind, artifactId })) } })
    }),
  )

  const transport = new StdioServerTransport()
  transport.onclose = () => process.exit(0)
  process.stdin.on('end', () => process.exit(0))
  await server.connect(transport)
}
