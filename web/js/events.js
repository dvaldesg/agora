import { forwardStateChange } from './bridge.js'
import { refreshMessages, refreshParticipants } from './chat.js'
import { refreshComments } from './comments.js'
import { toast } from './dom.js'
import { renderPresence } from './header.js'
import { forgetArtifact, refreshArtifacts, reloadCurrentArtifact, renderArtifactList, selectArtifact, sendFocus } from './navigation.js'
import { state } from './store.js'

const onPresence = async ({ event }) => {
  state.peers = event.peers
  renderPresence()
  renderArtifactList()
  await refreshParticipants()
}

const onHello = async ({ event }) => {
  state.connId = event.connId
  sendFocus()
  await onPresence({ event })
}

const onArtifactOrComment = async ({ event, isCurrent }) => {
  await refreshArtifacts()
  if (event.type === 'artifact.created' && !state.currentId) return selectArtifact({ id: event.artifactId, push: true })
  if (!isCurrent) return
  if (event.type === 'artifact.updated') return reloadCurrentArtifact({ event })
  if (!event.type.startsWith('comment.')) return
  await refreshComments()
  if (event.type === 'comment.created' && event.actor !== state.name) toast({ text: `${event.actor} commented: ${event.payload.body.slice(0, 90)}` })
}

const onMessage = async ({ event, isCurrent }) => {
  if (event.artifactId && !isCurrent) return
  if (state.tab !== 'chat' && event.actor !== state.name) state.unreadChat += 1
  await refreshMessages()
}

const handlers = {
  presence: onPresence,
  hello: onHello,
  'artifact.created': onArtifactOrComment,
  'artifact.updated': onArtifactOrComment,
  'comment.created': onArtifactOrComment,
  'comment.updated': onArtifactOrComment,
  'artifact.deleted': ({ event }) => forgetArtifact({ id: event.artifactId }),
  'message.sent': onMessage,
  'state.changed': ({ event, isCurrent }) => isCurrent && forwardStateChange({ event }),
}

export const connectStream = () => {
  const query = new URLSearchParams({ name: state.name, kind: 'human' })
  if (state.currentId) query.set('artifact', state.currentId)
  const source = new EventSource(`/api/stream?${query}`)
  source.onmessage = (message) => {
    const event = JSON.parse(message.data)
    const isCurrent = Boolean(event.artifactId) && event.artifactId === state.currentId
    Promise.resolve(handlers[event.type]?.({ event, isCurrent })).catch((error) => console.error(error))
  }
}
