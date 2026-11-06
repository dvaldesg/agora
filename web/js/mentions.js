import { h } from './dom.js'
import { avatar } from './people.js'
import { mentionables } from './store.js'

const MAX_SUGGESTIONS = 6

const tokenBeforeCaret = ({ textarea }) => {
  const upto = textarea.value.slice(0, textarea.selectionStart)
  const match = upto.match(/(^|\s)@([\w.-]*)$/)
  return match ? { query: match[2].toLowerCase(), start: upto.length - match[2].length - 1 } : null
}

export const attachMentions = ({ textarea }) => {
  const menu = h('div', { class: 'mention-menu', hidden: true })
  textarea.after(menu)
  let matches = []
  let active = 0

  const close = () => {
    menu.hidden = true
    matches = []
  }

  const pick = ({ name }) => {
    const token = tokenBeforeCaret({ textarea })
    if (!token) return
    const before = textarea.value.slice(0, token.start)
    const after = textarea.value.slice(textarea.selectionStart)
    textarea.value = `${before}@${name} ${after}`
    const caret = before.length + name.length + 2
    textarea.setSelectionRange(caret, caret)
    close()
    textarea.focus()
  }

  const option = ({ participant, index }) =>
    h(
      'button',
      {
        type: 'button',
        class: `mention-option${index === active ? ' is-active' : ''}`,
        onmousedown: (event) => {
          event.preventDefault()
          pick({ name: participant.name })
        },
      },
      avatar({ name: participant.name, size: 'sm', agent: participant.kind === 'agent' }),
      h('span', null, participant.name),
      h('span', { class: 'muted' }, participant.online ? `${participant.kind} · online` : participant.kind),
    )

  const render = () => {
    menu.replaceChildren(...matches.map((participant, index) => option({ participant, index })))
    menu.hidden = !matches.length
  }

  textarea.addEventListener('input', () => {
    const token = tokenBeforeCaret({ textarea })
    if (!token) return close()
    matches = mentionables()
      .filter((participant) => participant.name.toLowerCase().startsWith(token.query))
      .slice(0, MAX_SUGGESTIONS)
    active = 0
    render()
  })

  textarea.addEventListener('keydown', (event) => {
    if (menu.hidden) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      active = (active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length
      render()
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      event.stopImmediatePropagation()
      pick({ name: matches[active].name })
      return
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  })

  textarea.addEventListener('blur', () => setTimeout(close, 120))
}

export const submitOnModEnter = ({ textarea, form }) =>
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit()
  })
