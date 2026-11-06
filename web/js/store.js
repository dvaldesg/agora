import { storage } from './dom.js'

export const state = {
  name: storage.get({ key: 'agora.name' }),
  artifacts: [],
  currentId: null,
  artifact: null,
  viewVersion: null,
  versions: [],
  comments: [],
  anchorStatus: new Map(),
  messages: [],
  peers: [],
  participants: [],
  connId: null,
  commentMode: false,
  anchor: null,
  pendingFocus: null,
  scrollY: 0,
  tab: 'comments',
  filter: 'open',
  search: '',
  openReplies: new Set(),
  unreadChat: 0,
  frameVersion: null,
  sidebarOpen: false,
  versionsOpen: false,
  panelOpen: storage.get({ key: 'agora.panelOpen' }) === '1',
}

export const shownVersion = () => state.viewVersion ?? state.artifact?.version

export const isViewingOld = () => state.viewVersion !== null && state.viewVersion !== state.artifact?.version

export const openThreads = () => state.comments.filter((comment) => comment.status !== 'resolved')

export const mentionables = () => [
  ...state.participants.filter((participant) => participant.name !== state.name),
  { name: 'all', kind: 'everyone', online: true },
]
