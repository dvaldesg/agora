import { api } from './api.js'
import { $, h, stop, timeAgo } from './dom.js'
import { postToFrame, sendHover, sendPins, sendSelection } from './frame.js'
import { renderPanelCount } from './layout.js'
import { attachMentions, submitOnModEnter } from './mentions.js'
import { avatar, isAgent } from './people.js'
import { openThreads, shownVersion, state } from './store.js'
import { viewVersion } from './versions.js'

const anchorLabel = ({ anchor }) => {
  const [first] = anchor.targets
  if (anchor.targets.length > 1) return `Area · ${anchor.targets.length} elements${first.text ? ` · “${first.text.slice(0, 40)}”` : ''}`
  return first.text ? `“${first.text.slice(0, 80)}”` : first.selector
}

const anchorChip = ({ anchor, onClick, onClear }) =>
  h(
    'div',
    { class: 'anchor-chip', title: anchor.targets.map((target) => target.selector).join('\n'), onclick: onClick },
    '⌖',
    h('span', null, anchorLabel({ anchor })),
    onClear ? h('button', { type: 'button', title: 'Remove selection', onclick: stop(onClear) }, '×') : null,
  )

export const setAnchor = ({ anchor }) => {
  state.anchor = anchor
  renderComments()
  sendSelection()
}

export const focusComment = ({ comment }) => {
  const isMissingHere = state.anchorStatus.get(comment.id) === 'missing' && comment.version !== shownVersion()
  if (!isMissingHere) return postToFrame({ message: { type: 'focus', anchor: comment.anchor, id: comment.id } })
  state.pendingFocus = { anchor: comment.anchor, id: comment.id }
  viewVersion({ version: comment.version })
}

const anchorPill = ({ comment }) => {
  const status = state.anchorStatus.get(comment.id)
  if (!comment.anchor || !status || status === 'found' || status === 'moved') return null
  if (status === 'changed') return h('span', { class: 'pill is-changed' }, `changed since v${comment.version}`)
  if (status === 'partial') return h('span', { class: 'pill is-changed' }, 'partly missing')
  const viewOriginal =
    comment.version === shownVersion() ? null : h('button', { class: 'link-btn', onclick: () => focusComment({ comment }) }, `view v${comment.version}`)
  return h('span', { class: 'pill is-missing' }, `not in v${shownVersion()} · `, viewOriginal)
}

const statusPill = ({ comment }) => {
  if (comment.status === 'claimed') return h('span', { class: 'pill is-claimed' }, `${comment.claimedBy} is on it`)
  if (comment.status === 'resolved') return h('span', { class: 'pill is-resolved' }, 'resolved')
  return null
}

const note = ({ comment, isRoot }) =>
  h(
    'div',
    { class: 'note' },
    avatar({ name: comment.author, size: 'sm', agent: isAgent({ name: comment.author }) }),
    h(
      'div',
      { class: 'note-main' },
      h(
        'div',
        { class: 'note-head' },
        h('span', { class: 'note-author' }, comment.author),
        h('span', { class: 'note-time' }, `${timeAgo({ iso: comment.createdAt })} · v${comment.version}`),
        isRoot && comment.assignee ? h('span', { class: 'pill is-assignee' }, `@${comment.assignee}`) : null,
        isRoot ? statusPill({ comment }) : null,
        isRoot ? anchorPill({ comment }) : null,
      ),
      isRoot && comment.anchor ? anchorChip({ anchor: comment.anchor, onClick: () => focusComment({ comment }) }) : null,
      h('div', { class: 'note-body' }, comment.body),
    ),
  )

const postComment = ({ body }) => api({ path: `/api/artifacts/${state.currentId}/comments`, method: 'POST', body: { author: state.name, ...body } })

const replyForm = ({ thread }) => {
  const textarea = h('textarea', { class: 'input', rows: '2', placeholder: 'Reply… type @ to mention' })
  const form = h(
    'form',
    {
      class: 'reply',
      onsubmit: async (event) => {
        event.preventDefault()
        const body = textarea.value.trim()
        if (!body) return
        await postComment({ body: { body, parentId: thread.id } })
        state.openReplies.delete(thread.id)
        await refreshComments()
      },
    },
    textarea,
    h('div', { class: 'composer-row' }, h('span'), h('button', { class: 'btn btn-primary btn-sm' }, 'Reply')),
  )
  attachMentions({ textarea })
  submitOnModEnter({ textarea, form })
  return form
}

const setThreadStatus = async ({ thread, status }) => {
  await api({ path: `/api/comments/${thread.id}/status`, method: 'POST', body: { status, author: state.name } })
  await refreshComments()
}

const openReply = ({ thread }) => {
  state.openReplies.add(thread.id)
  renderComments()
  $(`#thread-${thread.id} textarea`)?.focus()
}

const threadCard = ({ thread }) => {
  const isReplying = state.openReplies.has(thread.id)
  const isResolved = thread.status === 'resolved'
  return h(
    'article',
    {
      class: `thread${isResolved ? ' is-resolved' : ''}`,
      id: `thread-${thread.id}`,
      onmouseenter: () => thread.anchor && sendHover({ anchor: thread.anchor }),
      onmouseleave: () => thread.anchor && sendHover({ anchor: null }),
    },
    note({ comment: thread, isRoot: true }),
    thread.replies.map((reply) => note({ comment: reply, isRoot: false })),
    isReplying ? replyForm({ thread }) : null,
    h(
      'div',
      { class: 'thread-actions' },
      isReplying ? null : h('button', { class: 'btn btn-sm', onclick: () => openReply({ thread }) }, 'Reply'),
      h(
        'button',
        { class: 'btn btn-sm', onclick: () => setThreadStatus({ thread, status: isResolved ? 'open' : 'resolved' }) },
        isResolved ? 'Reopen' : 'Resolve',
      ),
    ),
  )
}

export const renderComments = () => {
  const open = openThreads()
  const visible = state.filter === 'open' ? open : state.comments.filter((comment) => comment.status === 'resolved')
  const emptyText = state.filter === 'open' ? 'No open comments. Press C, then click an element or drag an area.' : 'Nothing resolved yet.'
  $('#comments-count').textContent = open.length || ''
  renderPanelCount()
  $('#threads').replaceChildren(...(visible.length ? visible.map((thread) => threadCard({ thread })) : [h('div', { class: 'placeholder' }, emptyText)]))
  const slot = $('#anchor')
  slot.hidden = !state.anchor
  const pending = state.anchor
    ? anchorChip({
        anchor: state.anchor,
        onClick: () => postToFrame({ message: { type: 'focus', anchor: state.anchor } }),
        onClear: () => setAnchor({ anchor: null }),
      })
    : null
  slot.replaceChildren(...[pending].filter(Boolean))
}

export const refreshComments = async () => {
  state.comments = state.currentId ? (await api({ path: `/api/artifacts/${state.currentId}/comments` })).comments : []
  renderComments()
  sendPins()
}

export const submitComment = async () => {
  const body = $('#comment-body').value.trim()
  if (!body || !state.currentId) return
  await postComment({
    body: { body, assignee: $('#comment-assignee').value || undefined, anchor: state.anchor ?? undefined, version: shownVersion() },
  })
  $('#comment-body').value = ''
  state.filter = 'open'
  setAnchor({ anchor: null })
  await refreshComments()
}

export const revealThread = ({ id }) => {
  state.filter = 'open'
  renderComments()
  const card = $(`#thread-${id}`)
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  card?.classList.add('is-flash')
  setTimeout(() => card?.classList.remove('is-flash'), 1600)
}
