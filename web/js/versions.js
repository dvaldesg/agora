import { api } from './api.js'
import { $, h, stop, timeAgo } from './dom.js'
import { loadFrame } from './frame.js'
import { renderHeader } from './header.js'
import { setVersionsMenu } from './layout.js'
import { isViewingOld, shownVersion, state } from './store.js'
import { renderComments } from './comments.js'

const diffClass = ({ line }) => {
  if (line.startsWith('@@')) return 'diff-hunk'
  if (line.startsWith('+')) return 'diff-add'
  if (line.startsWith('-')) return 'diff-del'
  return null
}

export const refreshVersions = async () => {
  if (!state.currentId) return
  state.versions = (await api({ path: `/api/artifacts/${state.currentId}/versions` })).versions
  renderVersions()
  renderVersionBanner()
}

export const viewVersion = ({ version }) => {
  state.viewVersion = version === state.artifact?.version ? null : version
  loadFrame()
  renderHeader()
  renderVersionBanner()
  renderVersions()
  renderComments()
}

export const showDiff = async ({ from }) => {
  const result = await api({ path: `/api/artifacts/${state.currentId}?since=${from}` })
  $('#diff-title').textContent = `v${from} → v${result.version}`
  const lines = result.diff.split('\n').slice(4)
  $('#diff-body').replaceChildren(...(lines.length ? lines.map((line) => h('span', { class: diffClass({ line }) }, `${line}\n`)) : ['No differences.']))
  $('#diff-dialog').showModal()
}

export const restoreVersion = async ({ version }) => {
  await api({ path: `/api/artifacts/${state.currentId}/restore`, method: 'POST', body: { version, author: state.name } })
  setVersionsMenu({ open: false })
  state.viewVersion = null
}

export const renderVersionBanner = () => {
  const banner = $('#version-banner')
  banner.hidden = !isViewingOld()
  if (!isViewingOld()) return
  const entry = state.versions.find((version) => version.version === state.viewVersion)
  const details = entry ? ` · ${entry.author}${entry.summary ? ` · ${entry.summary}` : ''}` : ''
  banner.replaceChildren(
    h('span', null, `Viewing v${state.viewVersion}${details}`),
    h('button', { class: 'btn btn-sm', onclick: () => showDiff({ from: state.viewVersion }) }, 'Diff vs latest'),
    h('button', { class: 'btn btn-sm restore-btn', onclick: () => restoreVersion({ version: state.viewVersion }) }, 'Restore'),
    h('button', { class: 'btn btn-sm btn-primary', onclick: () => viewVersion({ version: null }) }, `Back to v${state.artifact.version}`),
  )
}

const versionItem = ({ entry, latest }) => {
  const isLatest = entry.version === latest
  return h(
    'li',
    {
      class: `version-item${entry.version === shownVersion() ? ' is-viewing' : ''}`,
      onclick: () => {
        setVersionsMenu({ open: false })
        viewVersion({ version: entry.version })
      },
    },
    h('span', { class: 'version-num' }, `v${entry.version}`),
    h(
      'div',
      { class: 'version-main' },
      h('div', { class: 'version-summary' }, entry.summary || (isLatest ? 'latest' : 'no summary')),
      h('div', { class: 'version-meta' }, `${entry.author} · ${timeAgo({ iso: entry.createdAt })}${isLatest ? ' · latest' : ''}`),
    ),
    isLatest
      ? null
      : h(
          'div',
          { class: 'version-actions' },
          h('button', { class: 'btn btn-sm', onclick: stop(() => showDiff({ from: entry.version })) }, 'Diff'),
          h('button', { class: 'btn btn-sm', onclick: stop(() => restoreVersion({ version: entry.version })) }, 'Restore'),
        ),
  )
}

export const renderVersions = () => {
  const latest = state.artifact?.version
  $('#versions-note').textContent = state.versions.length ? `${state.versions.length} kept` : ''
  $('#versions-list').replaceChildren(...state.versions.map((entry) => versionItem({ entry, latest })))
}
