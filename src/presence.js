import { randomBytes } from 'node:crypto'

export function createPresence({ onChange }) {
  const peers = new Map()

  const list = () => [...peers.values()]

  const join = ({ name, kind, artifactId, remote }) => {
    const id = randomBytes(6).toString('hex')
    peers.set(id, { id, name, kind, artifactId: artifactId ?? null, remote, since: new Date().toISOString() })
    onChange({ peers: list() })
    return id
  }

  const leave = ({ id }) => {
    if (peers.delete(id)) onChange({ peers: list() })
  }

  const focus = ({ id, artifactId }) => {
    const peer = peers.get(id)
    if (!peer || peer.artifactId === artifactId) return Boolean(peer)
    peers.set(id, { ...peer, artifactId })
    onChange({ peers: list() })
    return true
  }

  return { list, join, leave, focus }
}
