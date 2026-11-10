const QUIET_TYPES = new Set(['state.changed'])

export const ACTIONABLE_TYPES = new Set(['comment.created', 'message.sent'])

const sameName = (left, right) => left?.toLowerCase() === right?.toLowerCase()

export const PEOPLE_ONLY = '@people'

export const isRelevant = ({ event, agent, all, artifactId }) => {
  if (artifactId && event.artifactId !== artifactId) return false
  if (agent && sameName(event.actor, agent)) return false
  if (agent && event.target === PEOPLE_ONLY) return false
  if (all || !agent) return true
  if (QUIET_TYPES.has(event.type)) return false
  return !event.target || event.target === 'all' || sameName(event.target, agent)
}
