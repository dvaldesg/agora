import { api } from './api.js'
import { handleStateRequest } from './bridge.js'
import { markChatRead, refreshParticipants, submitMessage } from './chat.js'
import { renderComments, revealThread, setAnchor, submitComment } from './comments.js'
import { $, storage, toast } from './dom.js'
import { connectStream } from './events.js'
import { frame, setCommentMode, syncFrame } from './frame.js'
import { renderHeader } from './header.js'
import { setPanel, setSidebar, setVersionsMenu, switchTab } from './layout.js'
import { attachMentions, submitOnModEnter } from './mentions.js'
import { idFromPath, importFile, refreshArtifacts, renderArtifactList, selectArtifact } from './navigation.js'
import { openShare } from './share.js'
import { isGuest, shownVersion, state } from './store.js'

const reportErrors =
  (task) =>
  (...args) =>
    Promise.resolve(task(...args)).catch((error) => toast({ text: error.message }))

const isTyping = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)

const showTab = ({ tab }) => switchTab({ tab, onChat: markChatRead })

const frameHandlers = {
  ready: () => syncFrame(),
  scroll: ({ data }) => {
    state.scrollY = data.y
  },
  cancel: () => setCommentMode({ on: false }),
  anchors: ({ data }) => {
    state.anchorStatus = new Map(data.results.map((result) => [result.id, result.status]))
    renderComments()
  },
  'focus-missing': () => toast({ text: `That part no longer exists in v${shownVersion()}` }),
  'state-request': ({ data }) => handleStateRequest({ data }),
  pick: ({ data }) => {
    setCommentMode({ on: false })
    setPanel({ open: true })
    showTab({ tab: 'comments' })
    setAnchor({ anchor: data.anchor })
    $('#comment-body').focus()
  },
  open: ({ data }) => {
    setPanel({ open: true })
    showTab({ tab: 'comments' })
    revealThread({ id: data.id })
  },
}

const onFrameMessage = (event) => {
  if (!event.data?.agora || event.source !== frame().contentWindow) return
  frameHandlers[event.data.type]?.({ data: event.data })
}

const closeMenusOnOutsideClick = (event) => {
  if (state.sidebarOpen && !$('#sidebar').contains(event.target)) setSidebar({ open: false })
  const insideVersions = $('#versions-menu').contains(event.target) || $('#diff-dialog').contains(event.target)
  if (state.versionsOpen && !insideVersions) setVersionsMenu({ open: false })
}

const onShortcut = (event) => {
  if (isTyping() || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'c') setCommentMode({ on: !state.commentMode })
  if (event.key !== 'Escape') return
  setCommentMode({ on: false })
  setSidebar({ open: false })
  setVersionsMenu({ open: false })
}

const bindComposer = ({ form, textarea, submit }) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    reportErrors(submit)()
  })
  submitOnModEnter({ textarea, form })
  attachMentions({ textarea })
}

const bindUi = () => {
  $('#toggle-sidebar').addEventListener('click', (event) => {
    event.stopPropagation()
    setSidebar({ open: !state.sidebarOpen })
  })
  $('#versions-btn').addEventListener('click', (event) => {
    event.stopPropagation()
    setVersionsMenu({ open: !state.versionsOpen })
  })
  $('#toggle-panel').addEventListener('click', () => setPanel({ open: !state.panelOpen }))
  $('#close-panel').addEventListener('click', () => setPanel({ open: false }))
  $('#comment-mode').addEventListener('click', () => setCommentMode({ on: !state.commentMode }))
  $('#share').addEventListener('click', reportErrors(openShare))
  $('#search').addEventListener('input', (event) => {
    state.search = event.target.value
    renderArtifactList()
  })
  $('#import').addEventListener('change', (event) => {
    const [file] = event.target.files
    if (file) reportErrors(importFile)({ file })
    event.target.value = ''
  })
  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => showTab({ tab: button.dataset.tab })))
  document.querySelectorAll('.chip[data-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter
      document.querySelectorAll('.chip[data-filter]').forEach((chip) => chip.classList.toggle('is-active', chip === button))
      renderComments()
    }),
  )
  bindComposer({ form: $('#comment-form'), textarea: $('#comment-body'), submit: submitComment })
  bindComposer({ form: $('#message-form'), textarea: $('#message-body'), submit: submitMessage })
  document.addEventListener('click', closeMenusOnOutsideClick)
  document.addEventListener('keydown', onShortcut)
  frame().addEventListener('load', syncFrame)
  addEventListener('message', onFrameMessage)
  addEventListener('popstate', () => selectArtifact({ id: idFromPath(), push: false }))
  setInterval(() => {
    renderHeader()
    renderArtifactList()
  }, 60_000)
  setPanel({ open: state.panelOpen })
}

const askName = () =>
  new Promise((resolve) => {
    $('#name-form').addEventListener('submit', () => resolve($('#name-input').value.trim()), { once: true })
    $('#name-dialog').addEventListener('cancel', (event) => event.preventDefault())
    $('#name-dialog').showModal()
    $('#name-input').focus()
  })

const start = async () => {
  if (!state.name) {
    state.name = (await askName()) || `guest-${Math.random().toString(36).slice(2, 6)}`
    storage.set({ key: 'agora.name', value: state.name })
  }
  state.session = await api({ path: '/api/session' })
  document.body.classList.toggle('is-guest', isGuest())
  bindUi()
  await Promise.all([refreshArtifacts(), refreshParticipants()])
  const id = isGuest() ? state.session.artifactId : (idFromPath() ?? state.artifacts[0]?.id ?? null)
  await selectArtifact({ id, push: Boolean(id) && !idFromPath() })
  connectStream()
}

reportErrors(start)()
