import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'

const SCHEMA = `
create table if not exists artifacts (
  id text primary key,
  title text not null,
  version integer not null,
  created_by text not null,
  created_at text not null,
  updated_by text not null,
  updated_at text not null
);
create table if not exists versions (
  artifact_id text not null references artifacts(id),
  version integer not null,
  html text not null,
  author text not null,
  summary text,
  created_at text not null,
  primary key (artifact_id, version)
);
create table if not exists comments (
  id text primary key,
  artifact_id text not null references artifacts(id),
  parent_id text references comments(id),
  body text not null,
  author text not null,
  assignee text,
  status text not null default 'open',
  claimed_by text,
  anchor text,
  version integer not null,
  created_at text not null,
  updated_at text not null
);
create table if not exists messages (
  id text primary key,
  artifact_id text references artifacts(id),
  sender text not null,
  recipient text not null,
  body text not null,
  created_at text not null
);
create table if not exists events (
  seq integer primary key autoincrement,
  type text not null,
  artifact_id text,
  actor text not null,
  target text,
  payload text not null,
  created_at text not null
);
create table if not exists participants (
  name text primary key collate nocase,
  kind text not null,
  first_seen text not null,
  last_seen text not null
);
create table if not exists artifact_state (
  artifact_id text not null references artifacts(id),
  scope text not null,
  key text not null,
  value text not null,
  updated_by text not null,
  updated_at text not null,
  primary key (artifact_id, scope, key)
);
create table if not exists hooks (
  id text primary key,
  name text not null,
  url text not null,
  created_at text not null
);
create table if not exists share_links (
  token text primary key,
  artifact_id text not null references artifacts(id),
  label text,
  created_by text not null,
  created_at text not null
);
create index if not exists comments_artifact on comments(artifact_id, created_at);
create index if not exists share_links_artifact on share_links(artifact_id);
create index if not exists messages_artifact on messages(artifact_id, created_at);
create index if not exists events_artifact on events(artifact_id, seq);
`

export class ConflictError extends Error {
  constructor({ currentVersion }) {
    super(`version conflict: artifact is at v${currentVersion}`)
    this.currentVersion = currentVersion
  }
}

export class NotFoundError extends Error {}

const newId = ({ prefix }) => `${prefix}_${randomBytes(5).toString('hex')}`
const now = () => new Date().toISOString()

const toArtifact = (row) => ({
  id: row.id,
  title: row.title,
  version: row.version,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
  ...(row.open_comments === undefined ? {} : { openComments: row.open_comments }),
})

const anchorOf = ({ row }) => {
  if (row.anchor) return JSON.parse(row.anchor)
  if (row.anchor_selector) return { mode: 'element', targets: [{ selector: row.anchor_selector, text: row.anchor_text ?? '' }] }
  return null
}

const toComment = (row) => ({
  id: row.id,
  artifactId: row.artifact_id,
  parentId: row.parent_id,
  body: row.body,
  author: row.author,
  assignee: row.assignee,
  status: row.status,
  claimedBy: row.claimed_by,
  anchor: anchorOf({ row }),
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toMessage = (row) => ({
  id: row.id,
  artifactId: row.artifact_id,
  sender: row.sender,
  recipient: row.recipient,
  body: row.body,
  createdAt: row.created_at,
})

const toEvent = (row) => ({
  seq: row.seq,
  type: row.type,
  artifactId: row.artifact_id,
  actor: row.actor,
  target: row.target,
  payload: JSON.parse(row.payload),
  createdAt: row.created_at,
})

const toStateItem = (row) => ({
  key: row.key,
  value: JSON.parse(row.value),
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
})

const migrate = ({ db }) => {
  const columns = db
    .prepare('pragma table_info(comments)')
    .all()
    .map((column) => column.name)
  if (!columns.includes('anchor')) db.exec('alter table comments add column anchor text')
}

export function openStore({ file, maxVersions = 50 }) {
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;')
  db.exec(SCHEMA)
  migrate({ db })

  const transaction = (fn) => {
    db.exec('begin')
    try {
      const result = fn()
      db.exec('commit')
      return result
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }

  const requireArtifactRow = ({ id }) => {
    const row = db.prepare('select * from artifacts where id = ?').get(id)
    if (!row) throw new NotFoundError(`artifact ${id} not found`)
    return row
  }

  const listArtifacts = () =>
    db
      .prepare(
        `select a.*, (
           select count(*) from comments c
           where c.artifact_id = a.id and c.parent_id is null and c.status != 'resolved'
         ) as open_comments
         from artifacts a order by a.updated_at desc`,
      )
      .all()
      .map(toArtifact)

  const getArtifact = ({ id, version }) => {
    const artifact = toArtifact(requireArtifactRow({ id }))
    const target = version ?? artifact.version
    const row = db.prepare('select html, author, summary, created_at from versions where artifact_id = ? and version = ?').get(id, target)
    if (!row) throw new NotFoundError(`artifact ${id} has no v${target} (pruned or never existed)`)
    return { ...artifact, html: row.html, viewedVersion: target, versionAuthor: row.author, versionSummary: row.summary }
  }

  const listVersions = ({ id }) => {
    requireArtifactRow({ id })
    return db
      .prepare('select version, author, summary, created_at from versions where artifact_id = ? order by version desc')
      .all(id)
      .map((row) => ({ version: row.version, author: row.author, summary: row.summary, createdAt: row.created_at }))
  }

  const pruneVersions = ({ id }) => {
    const versions = db
      .prepare('select version from versions where artifact_id = ? order by version desc')
      .all(id)
      .map((row) => row.version)
    if (versions.length <= maxVersions) return []
    const pinned = new Set(
      db
        .prepare("select distinct version from comments where artifact_id = ? and status != 'resolved'")
        .all(id)
        .map((row) => row.version),
    )
    pinned.add(1)
    const stale = versions.slice(maxVersions).filter((version) => !pinned.has(version))
    const remove = db.prepare('delete from versions where artifact_id = ? and version = ?')
    stale.forEach((version) => remove.run(id, version))
    return stale
  }

  const createArtifact = ({ title, html, author }) =>
    transaction(() => {
      const id = newId({ prefix: 'a' })
      const at = now()
      db.prepare('insert into artifacts (id, title, version, created_by, created_at, updated_by, updated_at) values (?, ?, 1, ?, ?, ?, ?)').run(
        id,
        title,
        author,
        at,
        author,
        at,
      )
      db.prepare('insert into versions (artifact_id, version, html, author, summary, created_at) values (?, 1, ?, ?, ?, ?)').run(
        id,
        html,
        author,
        'created',
        at,
      )
      return getArtifact({ id })
    })

  const deleteArtifact = ({ id }) =>
    transaction(() => {
      const artifact = toArtifact(requireArtifactRow({ id }))
      const tables = ['artifact_state', 'messages', 'versions', 'share_links']
      db.prepare('delete from comments where artifact_id = ? and parent_id is not null').run(id)
      db.prepare('delete from comments where artifact_id = ?').run(id)
      tables.forEach((table) => db.prepare(`delete from ${table} where artifact_id = ?`).run(id))
      db.prepare('delete from artifacts where id = ?').run(id)
      return artifact
    })

  const saveVersion = ({ id, baseVersion, html, author, summary, title }) =>
    transaction(() => {
      const current = requireArtifactRow({ id })
      if (current.version !== baseVersion) throw new ConflictError({ currentVersion: current.version })
      const version = current.version + 1
      const at = now()
      db.prepare('insert into versions (artifact_id, version, html, author, summary, created_at) values (?, ?, ?, ?, ?, ?)').run(
        id,
        version,
        html,
        author,
        summary ?? null,
        at,
      )
      db.prepare('update artifacts set version = ?, title = ?, updated_by = ?, updated_at = ? where id = ?').run(
        version,
        title ?? current.title,
        author,
        at,
        id,
      )
      pruneVersions({ id })
      return getArtifact({ id })
    })

  const getComment = ({ id }) => {
    const row = db.prepare('select * from comments where id = ?').get(id)
    if (!row) throw new NotFoundError(`comment ${id} not found`)
    return toComment(row)
  }

  const createComment = ({ artifactId, parentId, body, author, assignee, anchor, version }) => {
    const artifact = requireArtifactRow({ id: artifactId })
    const parent = parentId ? getComment({ id: parentId }) : null
    const id = newId({ prefix: 'c' })
    const at = now()
    db.prepare(
      `insert into comments (id, artifact_id, parent_id, body, author, assignee, status, anchor, version, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    ).run(id, artifactId, parent?.id ?? null, body, author, assignee ?? null, anchor ? JSON.stringify(anchor) : null, version ?? artifact.version, at, at)
    return getComment({ id })
  }

  const updateCommentStatus = ({ id, status, claimedBy }) => {
    getComment({ id })
    db.prepare('update comments set status = ?, claimed_by = ?, updated_at = ? where id = ?').run(status, claimedBy ?? null, now(), id)
    return getComment({ id })
  }

  const listComments = ({ artifactId, status }) => {
    const comments = db.prepare('select * from comments where artifact_id = ? order by created_at').all(artifactId).map(toComment)
    const repliesByParent = Map.groupBy(
      comments.filter((comment) => comment.parentId),
      (comment) => comment.parentId,
    )
    return comments
      .filter((comment) => !comment.parentId)
      .filter((comment) => !status || comment.status === status)
      .map((comment) => ({ ...comment, replies: repliesByParent.get(comment.id) ?? [] }))
  }

  const createMessage = ({ artifactId, sender, recipient, body }) => {
    if (artifactId) requireArtifactRow({ id: artifactId })
    const id = newId({ prefix: 'm' })
    db.prepare('insert into messages (id, artifact_id, sender, recipient, body, created_at) values (?, ?, ?, ?, ?, ?)').run(
      id,
      artifactId ?? null,
      sender,
      recipient,
      body,
      now(),
    )
    return toMessage(db.prepare('select * from messages where id = ?').get(id))
  }

  const listMessages = ({ artifactId, participant, onlyArtifact = false, limit = 100 }) => {
    const clauses = []
    const params = []
    if (artifactId) {
      clauses.push(onlyArtifact ? 'artifact_id = ?' : '(artifact_id = ? or artifact_id is null)')
      params.push(artifactId)
    }
    if (participant) {
      clauses.push("(recipient = ? collate nocase or sender = ? collate nocase or recipient = 'all')")
      params.push(participant, participant)
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
    return db
      .prepare(`select * from (select * from messages ${where} order by created_at desc limit ?) order by created_at`)
      .all(...params, limit)
      .map(toMessage)
  }

  const upsertParticipant = ({ name, kind }) => {
    const at = now()
    db.prepare(
      `insert into participants (name, kind, first_seen, last_seen) values (?, ?, ?, ?)
       on conflict(name) do update set last_seen = excluded.last_seen,
         kind = case when participants.kind = 'agent' then 'agent' else excluded.kind end`,
    ).run(name, kind, at, at)
  }

  const listParticipants = () =>
    db
      .prepare('select name, kind, first_seen, last_seen from participants order by last_seen desc')
      .all()
      .map((row) => ({ name: row.name, kind: row.kind, firstSeen: row.first_seen, lastSeen: row.last_seen }))

  const findParticipant = ({ name }) => {
    const row = db.prepare('select name, kind from participants where name = ? collate nocase').get(name)
    return row ? { name: row.name, kind: row.kind } : null
  }

  const listState = ({ artifactId, scope, prefix = '' }) => {
    requireArtifactRow({ id: artifactId })
    return db
      .prepare('select * from artifact_state where artifact_id = ? and scope = ? and substr(key, 1, ?) = ? order by key')
      .all(artifactId, scope, prefix.length, prefix)
      .map(toStateItem)
  }

  const getState = ({ artifactId, scope, key }) => {
    requireArtifactRow({ id: artifactId })
    const row = db.prepare('select * from artifact_state where artifact_id = ? and scope = ? and key = ?').get(artifactId, scope, key)
    return row ? toStateItem(row) : null
  }

  const setState = ({ artifactId, scope, key, value, author }) => {
    requireArtifactRow({ id: artifactId })
    db.prepare(
      `insert into artifact_state (artifact_id, scope, key, value, updated_by, updated_at) values (?, ?, ?, ?, ?, ?)
       on conflict(artifact_id, scope, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(artifactId, scope, key, JSON.stringify(value), author, now())
    return getState({ artifactId, scope, key })
  }

  const deleteState = ({ artifactId, scope, key }) =>
    db.prepare('delete from artifact_state where artifact_id = ? and scope = ? and key = ?').run(artifactId, scope, key).changes > 0

  const listHooks = () =>
    db
      .prepare('select * from hooks order by created_at')
      .all()
      .map((row) => ({ id: row.id, name: row.name, url: row.url, createdAt: row.created_at }))

  const createHook = ({ name, url }) => {
    const id = newId({ prefix: 'h' })
    db.prepare('insert into hooks (id, name, url, created_at) values (?, ?, ?, ?)').run(id, name, url, now())
    return listHooks().find((hook) => hook.id === id)
  }

  const deleteHook = ({ id }) => db.prepare('delete from hooks where id = ?').run(id).changes > 0

  const toShareLink = (row) => ({ token: row.token, artifactId: row.artifact_id, label: row.label, createdBy: row.created_by, createdAt: row.created_at })

  const listShareLinks = ({ artifactId }) => db.prepare('select * from share_links where artifact_id = ? order by created_at').all(artifactId).map(toShareLink)

  const findShareLink = ({ token }) => {
    const row = db.prepare('select * from share_links where token = ?').get(token)
    return row ? toShareLink(row) : null
  }

  const createShareLink = ({ artifactId, label, author }) => {
    requireArtifactRow({ id: artifactId })
    const token = randomBytes(18).toString('base64url')
    db.prepare('insert into share_links (token, artifact_id, label, created_by, created_at) values (?, ?, ?, ?, ?)').run(
      token,
      artifactId,
      label ?? null,
      author,
      now(),
    )
    return findShareLink({ token })
  }

  const deleteShareLink = ({ token }) => db.prepare('delete from share_links where token = ?').run(token).changes > 0

  const appendEvent = ({ type, artifactId, actor, target, payload }) => {
    const result = db
      .prepare('insert into events (type, artifact_id, actor, target, payload, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(type, artifactId ?? null, actor, target ?? null, JSON.stringify(payload ?? {}), now())
    return toEvent(db.prepare('select * from events where seq = ?').get(result.lastInsertRowid))
  }

  const eventsSince = ({ since, limit = 200 }) => db.prepare('select * from events where seq > ? order by seq limit ?').all(since, limit).map(toEvent)

  const headSeq = () => db.prepare('select coalesce(max(seq), 0) as seq from events').get().seq

  return {
    listArtifacts,
    getArtifact,
    listVersions,
    createArtifact,
    deleteArtifact,
    saveVersion,
    getComment,
    createComment,
    updateCommentStatus,
    listComments,
    createMessage,
    listMessages,
    upsertParticipant,
    listParticipants,
    findParticipant,
    listState,
    getState,
    setState,
    deleteState,
    listHooks,
    createHook,
    deleteHook,
    listShareLinks,
    findShareLink,
    createShareLink,
    deleteShareLink,
    appendEvent,
    eventsSince,
    headSeq,
  }
}
