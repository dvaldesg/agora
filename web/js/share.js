import { api } from './api.js'
import { $, h, toast } from './dom.js'
import { state } from './store.js'

const copyLink = async ({ value, input }) => {
  await navigator.clipboard.writeText(value).catch(() => input.select())
  toast({ text: 'Link copied' })
}

const linkField = ({ label, value, extra }) => {
  const input = h('input', { class: 'input', readonly: true, value })
  return h(
    'div',
    { class: 'share-row' },
    h('span', { class: 'share-label' }, label),
    h('div', { class: 'share-field' }, input, h('button', { class: 'btn', type: 'button', onclick: () => copyLink({ value, input }) }, 'Copy'), extra),
  )
}

const hint = (...children) => h('p', { class: 'share-hint' }, ...children)

const revokeButton = ({ link }) =>
  h(
    'button',
    {
      class: 'btn btn-ghost',
      type: 'button',
      onclick: async () => {
        if (!confirm('Revoke this link? Whoever has it loses access right away.')) return
        await api({ path: `/api/links/${link.token}`, method: 'DELETE' })
        await renderArtifactLinks()
      },
    },
    'Revoke',
  )

const renderArtifactLinks = async () => {
  const { links, lanEnabled } = await api({ path: `/api/artifacts/${state.currentId}/links` })
  const rows = links.map((link) => linkField({ label: link.label ? `For ${link.label}` : 'Link', value: link.url, extra: revokeButton({ link }) }))
  const notes = [
    links.length ? null : hint('No links yet.'),
    lanEnabled ? null : hint('Links open on other devices once the hub runs with ', h('code', null, 'agora daemon --lan'), ' or behind a private tunnel.'),
  ]
  $('#artifact-links').replaceChildren(...rows, ...notes.filter(Boolean))
}

const createLink = async (event) => {
  event.preventDefault()
  const label = $('#new-link-label').value.trim()
  await api({ path: `/api/artifacts/${state.currentId}/links`, method: 'POST', body: { label, author: state.name } })
  $('#new-link-label').value = ''
  await renderArtifactLinks()
}

const artifactSection = () =>
  h(
    'section',
    { class: 'share-section' },
    h('h3', null, 'Only this artifact'),
    hint('People with the link can open and use this artifact and comment on it. They cannot see your other artifacts or change its HTML.'),
    h('div', { id: 'artifact-links' }),
    h(
      'form',
      { class: 'share-field share-new', onsubmit: (event) => createLink(event).catch((error) => toast({ text: error.message })) },
      h('input', { class: 'input', id: 'new-link-label', maxlength: '60', placeholder: 'Who is it for? (optional)' }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create link'),
    ),
  )

const hubSection = ({ links }) =>
  h(
    'section',
    { class: 'share-section' },
    h('h3', null, 'All of AGORA'),
    hint('Full access to every artifact. Only for your own devices.'),
    linkField({ label: 'This machine', value: links.local }),
    links.lan
      ? linkField({ label: 'Your network (includes access token)', value: links.lan })
      : hint(
          'To open it from your phone, restart the hub with ',
          h('code', null, 'agora daemon --lan'),
          `. Away from home, use a private tunnel to port ${links.port} such as Tailscale or VS Code port forwarding.`,
        ),
  )

export const openShare = async () => {
  const links = await api({ path: `/api/share${state.currentId ? `/${state.currentId}` : ''}` })
  $('#share-body').replaceChildren(...[state.currentId ? artifactSection() : null, hubSection({ links })].filter(Boolean))
  $('#share-dialog').showModal()
  if (state.currentId) await renderArtifactLinks()
}
