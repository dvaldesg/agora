import { h } from './dom.js'
import { state } from './store.js'

const FIXED_COLORS = { claude: 'var(--claude)', codex: 'var(--codex)' }

export const colorFor = ({ name }) => {
  const fixed = FIXED_COLORS[name?.toLowerCase()]
  if (fixed) return fixed
  const hue = ([...(name ?? '?')].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 47) % 360
  return `hsl(${hue} 55% 50%)`
}

export const isAgent = ({ name }) => {
  const lower = name?.toLowerCase()
  if (FIXED_COLORS[lower]) return true
  return state.participants.some((participant) => participant.name.toLowerCase() === lower && participant.kind === 'agent')
}

export const avatar = ({ name, size, away, agent, tip }) =>
  h(
    'span',
    {
      class: ['avatar', size, away && 'is-away', agent && 'is-agent'].filter(Boolean).join(' '),
      style: `background:${colorFor({ name })}`,
      'data-tip': tip,
      title: tip ? null : name,
    },
    (name ?? '?').slice(0, 2),
  )
