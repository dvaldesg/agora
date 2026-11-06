export const $ = (selector) => document.querySelector(selector)

export const h = (tag, props, ...children) => {
  const element = document.createElement(tag)
  Object.entries(props ?? {}).forEach(([key, value]) => {
    if (value == null || value === false) return
    if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'class') element.className = value
    else if (key === 'style') element.style.cssText = value
    else element.setAttribute(key, value === true ? '' : value)
  })
  children.flat().forEach((child) => {
    if (child == null || child === false) return
    element.append(child instanceof Node ? child : String(child))
  })
  return element
}

export const storage = {
  get: ({ key }) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set: ({ key, value }) => {
    try {
      localStorage.setItem(key, value)
    } catch {}
  },
}

export const timeAgo = ({ iso }) => {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString()
}

export const toast = ({ text }) => {
  const element = h('div', { class: 'toast' }, text)
  $('#toasts').append(element)
  setTimeout(() => element.remove(), 4200)
}

export const stop = (handler) => (event) => {
  event.stopPropagation()
  handler(event)
}
