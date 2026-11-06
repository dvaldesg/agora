import { $, storage, toast } from './dom.js'
import { openThreads, state } from './store.js'
import { refreshVersions } from './versions.js'

export const setSidebar = ({ open }) => {
  state.sidebarOpen = open
  $('#sidebar').classList.toggle('is-closed', !open)
  $('#toggle-sidebar').classList.toggle('is-on', open)
  if (!open) return
  setVersionsMenu({ open: false })
  $('#search').focus()
}

export const setPanel = ({ open }) => {
  state.panelOpen = open
  $('#panel').classList.toggle('is-closed', !open)
  $('#toggle-panel').classList.toggle('is-on', open)
  storage.set({ key: 'agora.panelOpen', value: open ? '1' : '0' })
}

export const setVersionsMenu = ({ open }) => {
  state.versionsOpen = open && Boolean(state.artifact)
  $('#versions-menu').classList.toggle('is-closed', !state.versionsOpen)
  $('#versions-btn').classList.toggle('is-on', state.versionsOpen)
  if (!state.versionsOpen) return
  setSidebar({ open: false })
  refreshVersions().catch((error) => toast({ text: error.message }))
}

export const renderPanelCount = () => {
  const total = openThreads().length + state.unreadChat
  const count = $('#panel-count')
  count.textContent = total || ''
  count.classList.toggle('is-hot', state.unreadChat > 0)
}

export const switchTab = ({ tab, onChat }) => {
  state.tab = tab
  document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === tab))
  $('#tab-comments').hidden = tab !== 'comments'
  $('#tab-chat').hidden = tab !== 'chat'
  if (tab === 'chat') onChat?.()
}
