import { api } from './api.js'
import { $, h, toast } from './dom.js'
import { state } from './store.js'

const linkField = ({ label, value }) => {
  const input = h('input', { class: 'input', readonly: true, value })
  const copy = async () => {
    await navigator.clipboard.writeText(value).catch(() => input.select())
    toast({ text: 'Link copied' })
  }
  return h(
    'div',
    { class: 'share-row' },
    h('span', { class: 'share-label' }, label),
    h('div', { class: 'share-field' }, input, h('button', { class: 'btn', type: 'button', onclick: copy }, 'Copy')),
  )
}

const localOnlyHint = ({ port }) =>
  h(
    'p',
    { class: 'share-hint' },
    'Only you can open this right now. To share on your network, restart the hub with ',
    h('code', null, 'agora daemon --lan'),
    `. To share beyond it, forward port ${port} (VS Code Ports panel, `,
    h('code', null, 'cloudflared'),
    ', or ',
    h('code', null, 'tailscale serve'),
    ').',
  )

export const openShare = async () => {
  const links = await api({ path: `/api/share${state.currentId ? `/${state.currentId}` : ''}` })
  $('#share-body').replaceChildren(
    linkField({ label: 'This machine', value: links.local }),
    links.lan ? linkField({ label: 'Your network (includes access token)', value: links.lan }) : localOnlyHint({ port: links.port }),
  )
  $('#share-dialog').showModal()
}
