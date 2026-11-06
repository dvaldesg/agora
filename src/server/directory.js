export function createDirectory({ store }) {
  const resolveName = ({ name }) => {
    if (!name) return null
    if (name.toLowerCase() === 'all') return 'all'
    return store.findParticipant({ name })?.name ?? null
  }

  const mentionsIn = ({ body }) => [...body.matchAll(/@([\w.-]+)/g)].map((match) => resolveName({ name: match[1] })).filter(Boolean)

  return { resolveName, mentionsIn }
}
