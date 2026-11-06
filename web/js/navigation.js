import { api } from './api.js'
import { $, h, toast } from './dom.js'
import { renderMessages, refreshMessages, renderSelects } from './chat.js'
import { refreshComments, renderComments } from './comments.js'
import { frame, loadFrame, setCommentMode } from './frame.js'
import { renderHeader, renderPresence, renderSidebar } from './header.js'
import { setSidebar, setVersionsMenu } from './layout.js'
import { isViewingOld, state } from './store.js'
import { refreshVersions, renderVersionBanner } from './versions.js'

export const idFromPath = () => location.pathname.match(/^\/a\/([\w-]+)/)?.[1] ?? null

const renderEmpty = () => {
  const hasArtifact = Boolean(state.artifact)
  $('#empty').hidden = hasArtifact
  frame().hidden = !hasArtifact
  if (hasArtifact) return
  $('#empty').replaceChildren(
    h(
      'div',
      null,
      h('h2', null, state.artifacts.length ? 'Pick an artifact' : 'No artifacts yet'),
      h(
        'p',
        null,
        'Ask any connected agent to create one with ',
        h('code', null, 'agora_create'),
        ', run ',
        h('code', null, 'agora push file.html'),
        ', or use + New.',
      ),
    ),
  )
}

export const renderArtifactList = () =>
  renderSidebar({
    onSelect: ({ id }) => {
      setSidebar({ open: false })
      selectArtifact({ id, push: true })
    },
    onDelete: ({ artifact }) => {
      if (!confirm(`Delete "${artifact.title}" with all its versions, comments and data? This cannot be undone.`)) return
      const path = `/api/artifacts/${artifact.id}?as=${encodeURIComponent(state.name)}`
      api({ path, method: 'DELETE' }).catch((error) => toast({ text: error.message }))
    },
  })

export const forgetArtifact = async ({ id }) => {
  await refreshArtifacts()
  if (id !== state.currentId) return
  const next = state.artifacts[0]?.id ?? null
  await selectArtifact({ id: next, push: true })
}

export const renderAll = () => {
  renderArtifactList()
  renderHeader()
  renderVersionBanner()
  renderPresence()
  renderSelects()
  renderComments()
  renderMessages()
  renderEmpty()
}

export const refreshArtifacts = async () => {
  state.artifacts = (await api({ path: '/api/artifacts' })).artifacts
  renderArtifactList()
  renderEmpty()
}

export const sendFocus = () => {
  if (!state.connId) return
  api({ path: `/api/presence/${state.connId}`, method: 'POST', body: { artifactId: state.currentId } }).catch(() => {})
}

export const selectArtifact = async ({ id, push }) => {
  if (push) history.pushState({}, '', id ? `/a/${id}` : '/')
  Object.assign(state, { currentId: id, anchor: null, scrollY: 0, viewVersion: null, versions: [] })
  state.openReplies.clear()
  setCommentMode({ on: false })
  setVersionsMenu({ open: false })
  state.artifact = id ? await api({ path: `/api/artifacts/${id}` }).catch(() => null) : null
  if (!state.artifact) state.currentId = null
  sendFocus()
  loadFrame()
  await Promise.all([refreshComments(), refreshMessages(), refreshVersions()])
  renderAll()
}

export const reloadCurrentArtifact = async ({ event }) => {
  state.artifact = await api({ path: `/api/artifacts/${state.currentId}` })
  const summary = event.payload.summary ? `: ${event.payload.summary}` : ''
  if (isViewingOld()) {
    toast({ text: `${event.actor} published v${event.payload.version}${summary} · you are viewing v${state.viewVersion}` })
  } else {
    state.viewVersion = null
    if (state.frameVersion !== state.artifact.version) loadFrame()
    toast({ text: `${event.actor} published v${event.payload.version}${summary}` })
  }
  renderHeader()
  await refreshVersions()
}

export const importFile = async ({ file }) => {
  const artifact = await api({
    path: '/api/artifacts',
    method: 'POST',
    body: { title: file.name.replace(/\.html?$/i, ''), html: await file.text(), author: state.name },
  })
  await refreshArtifacts()
  await selectArtifact({ id: artifact.id, push: true })
}
