import { $ } from './dom.js'
import { isGuest, openThreads, shownVersion, state } from './store.js'

export const frame = () => $('#view')

export const postToFrame = ({ message }) => frame().contentWindow?.postMessage({ agora: true, ...message }, '*')

export const loadFrame = () => {
  if (!state.artifact) return
  state.frameVersion = shownVersion()
  state.anchorStatus = new Map()
  const query = new URLSearchParams({ v: String(shownVersion()), sy: String(state.scrollY), as: state.name, ...(isGuest() ? { ro: '1' } : {}) })
  frame().src = `/raw/${state.artifact.id}?${query}`
}

export const sendPins = () => {
  const pins = openThreads()
    .filter((comment) => comment.anchor?.targets?.length)
    .map((comment, index) => ({ id: comment.id, anchor: comment.anchor, label: String(index + 1), preview: comment.body.slice(0, 80) }))
  postToFrame({ message: { type: 'pins', pins } })
}

export const sendSelection = () => postToFrame({ message: { type: 'selection', anchor: state.anchor } })

export const sendHover = ({ anchor }) => postToFrame({ message: { type: 'hover', anchor } })

export const setCommentMode = ({ on }) => {
  state.commentMode = on && Boolean(state.artifact)
  $('#comment-mode').classList.toggle('is-on', state.commentMode)
  $('#mode-hint').hidden = !state.commentMode
  postToFrame({ message: { type: 'mode', on: state.commentMode } })
}

export const syncFrame = () => {
  sendPins()
  sendSelection()
  postToFrame({ message: { type: 'mode', on: state.commentMode } })
  if (!state.pendingFocus) return
  postToFrame({ message: { type: 'focus', ...state.pendingFocus } })
  state.pendingFocus = null
}
