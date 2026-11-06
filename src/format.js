const clip = ({ text, max = 280 }) => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export const describeAnchor = ({ anchor }) => {
  if (!anchor?.targets?.length) return ''
  const [first, ...rest] = anchor.targets
  const label = first.text ? `${first.selector} "${clip({ text: first.text, max: 60 })}"` : first.selector
  const extra = rest.length ? ` (+${rest.length} more, area)` : ''
  return ` on ${label}${extra}`
}

const describers = {
  'artifact.created': ({ event }) => `[artifact.created] "${event.payload.title}" (${event.artifactId}) v1 by ${event.actor}`,
  'artifact.deleted': ({ event }) => `[artifact.deleted] "${event.payload.title}" (${event.artifactId}) by ${event.actor}`,
  'artifact.updated': ({ event }) => {
    const summary = event.payload.summary ? `: ${clip({ text: event.payload.summary })}` : ''
    return `[artifact.updated] "${event.payload.title}" (${event.artifactId}) now v${event.payload.version} by ${event.actor}${summary}`
  },
  'comment.created': ({ event }) => {
    const comment = event.payload
    const kind = comment.parentId ? `reply in thread ${comment.parentId}` : 'comment'
    const target = event.target ? ` → @${event.target}` : ''
    return `[${kind}] ${comment.id} on ${event.artifactId} v${comment.version} by ${event.actor}${target}${describeAnchor({ anchor: comment.anchor })}: "${clip({ text: comment.body })}"`
  },
  'comment.updated': ({ event }) => `[comment.${event.payload.status}] ${event.payload.id} on ${event.artifactId} by ${event.actor}`,
  'message.sent': ({ event }) => {
    const scope = event.artifactId ? ` (${event.artifactId})` : ''
    return `[message] ${event.actor} → ${event.target}${scope}: "${clip({ text: event.payload.body })}"`
  },
  'state.changed': ({ event }) => {
    const verb = event.payload.deleted ? 'deleted' : 'set'
    return `[state.${verb}] ${event.payload.scope} key "${event.payload.key}" on ${event.artifactId} by ${event.actor}`
  },
}

export const describeEvent = ({ event }) => describers[event.type]?.({ event }) ?? `[${event.type}] ${event.artifactId ?? ''} by ${event.actor}`
