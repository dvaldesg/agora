import { api } from './api.js'
import { $, h, timeAgo } from './dom.js'
import { renderPanelCount } from './layout.js'
import { avatar, isAgent } from './people.js'
import { state } from './store.js'

const fillSelect = ({ select, first, others }) => {
  const previous = select.value
  select.replaceChildren(
    h('option', { value: first.value }, first.label),
    ...others.map((participant) => h('option', { value: participant.name }, `@${participant.name}${participant.online ? '' : ' (offline)'}`)),
  )
  select.value = [...select.options].some((option) => option.value === previous) ? previous : first.value
}

export const renderSelects = () => {
  const others = state.participants.filter((participant) => participant.name !== state.name)
  fillSelect({ select: $('#comment-assignee'), first: { value: '', label: 'Anyone' }, others })
  fillSelect({ select: $('#message-to'), first: { value: 'all', label: 'To everyone' }, others })
}

export const refreshParticipants = async () => {
  state.participants = (await api({ path: '/api/participants' })).participants
  renderSelects()
}

const messageRow = ({ message }) =>
  h(
    'div',
    { class: 'message' },
    avatar({ name: message.sender, size: 'sm', agent: isAgent({ name: message.sender }) }),
    h(
      'div',
      { class: 'message-main' },
      h(
        'div',
        { class: 'note-head' },
        h('span', { class: 'note-author' }, message.sender),
        h('span', { class: 'message-to' }, `→ ${message.recipient}`),
        h('span', { class: 'note-time' }, timeAgo({ iso: message.createdAt })),
      ),
      h('div', { class: 'note-body' }, message.body),
    ),
  )

export const renderMessages = () => {
  const count = $('#chat-count')
  count.textContent = state.unreadChat || ''
  count.classList.toggle('is-hot', state.unreadChat > 0)
  renderPanelCount()
  const empty = h('div', { class: 'placeholder' }, 'Messages between you and the connected agents show up here.')
  $('#messages').replaceChildren(...(state.messages.length ? state.messages.map((message) => messageRow({ message })) : [empty]))
  $('#messages').scrollTop = $('#messages').scrollHeight
}

export const markChatRead = () => {
  state.unreadChat = 0
  renderMessages()
}

export const refreshMessages = async () => {
  const query = state.currentId ? `?artifact=${state.currentId}` : ''
  state.messages = (await api({ path: `/api/messages${query}` })).messages
  renderMessages()
}

export const submitMessage = async () => {
  const body = $('#message-body').value.trim()
  if (!body) return
  await api({
    path: '/api/messages',
    method: 'POST',
    body: { body, to: $('#message-to').value, artifactId: state.currentId ?? undefined, author: state.name },
  })
  $('#message-body').value = ''
}
