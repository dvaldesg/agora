import { $, h, stop, timeAgo } from './dom.js'
import { avatar, colorFor } from './people.js'
import { isViewingOld, shownVersion, state } from './store.js'

const uniqueByName = ({ peers }) => [...new Map(peers.map((peer) => [peer.name, peer])).values()]

const agentWhereabouts = ({ peer }) => {
  if (peer.artifactId === state.currentId) return 'on this artifact'
  const elsewhere = state.artifacts.find((artifact) => artifact.id === peer.artifactId)
  return elsewhere ? `on ${elsewhere.title}` : 'online'
}

export const renderHeader = () => {
  const artifact = state.artifact
  $('#art-title').textContent = artifact?.title ?? ''
  $('#art-meta').textContent = artifact ? `edited by ${artifact.updatedBy} ${timeAgo({ iso: artifact.updatedAt })}` : ''
  const versionsButton = $('#versions-btn')
  versionsButton.hidden = !artifact
  versionsButton.textContent = artifact ? `v${shownVersion()}${isViewingOld() ? ` of ${artifact.version}` : ''} ▾` : ''
  versionsButton.classList.toggle('is-old', isViewingOld())
  document.title = artifact ? `${artifact.title} · AGORA` : 'AGORA'
}

export const renderPresence = () => {
  const humans = uniqueByName({ peers: state.peers.filter((peer) => peer.kind === 'human' && peer.artifactId === state.currentId) })
  const agents = uniqueByName({ peers: state.peers.filter((peer) => peer.kind === 'agent') })
  const viewing = humans.length + agents.filter((peer) => peer.artifactId === state.currentId).length
  $('#presence').replaceChildren(
    h(
      'div',
      { class: 'presence-stack' },
      humans.map((peer) => avatar({ name: peer.name, tip: peer.name === state.name ? `${peer.name} (you)` : peer.name })),
      agents.map((peer) =>
        avatar({ name: peer.name, agent: true, away: peer.artifactId !== state.currentId, tip: `${peer.name} · ${agentWhereabouts({ peer })}` }),
      ),
    ),
    h('span', { class: 'presence-count' }, `${viewing} here`),
  )
}

export const renderSidebar = ({ onSelect, onDelete }) => {
  const term = state.search.toLowerCase()
  const items = state.artifacts.filter((artifact) => artifact.title.toLowerCase().includes(term))
  const viewersOf = ({ id }) => state.peers.filter((peer) => peer.artifactId === id)
  const item = ({ artifact }) =>
    h(
      'li',
      { class: `artifact-item${artifact.id === state.currentId ? ' is-active' : ''}`, onclick: () => onSelect({ id: artifact.id }) },
      h(
        'div',
        { class: 'artifact-item-title' },
        h('span', null, artifact.title),
        artifact.openComments ? h('span', { class: 'badge', title: 'Open comments' }, artifact.openComments) : null,
        h(
          'button',
          { class: 'item-delete', title: 'Delete artifact', 'aria-label': `Delete ${artifact.title}`, onclick: stop(() => onDelete({ artifact })) },
          '×',
        ),
      ),
      h(
        'div',
        { class: 'artifact-item-meta' },
        h('span', null, `v${artifact.version} · ${artifact.updatedBy} · ${timeAgo({ iso: artifact.updatedAt })}`),
        h(
          'span',
          { class: 'dot-row' },
          viewersOf({ id: artifact.id }).map((peer) => h('span', { class: 'dot', style: `background:${colorFor({ name: peer.name })}`, title: peer.name })),
        ),
      ),
    )
  const placeholder = h('li', { class: 'placeholder' }, state.artifacts.length ? 'No matches' : 'No artifacts yet')
  $('#artifact-list').replaceChildren(...(items.length ? items.map((artifact) => item({ artifact })) : [placeholder]))
}
