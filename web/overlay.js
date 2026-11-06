;(() => {
  if (window.__agoraOverlay) return
  window.__agoraOverlay = true

  const post = (data) => parent.postMessage({ agora: true, ...data }, '*')
  const params = new URLSearchParams(location.search)
  const initialScroll = Number(params.get('sy') || 0)
  const viewer = params.get('as') || 'anonymous'
  const DRAG_THRESHOLD = 6
  const MAX_TARGETS = 30
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'BR'])

  let commentMode = false
  let hovered = null
  let pins = []
  let drag = null
  let suppressClick = false
  const highlight = { selection: null, hover: null }

  const style = document.createElement('style')
  style.textContent = `
    .__agora-hover { outline: 2px solid #6d5efc !important; outline-offset: 2px !important; cursor: crosshair !important; }
    .__agora-flash { outline: 3px solid #f5a524 !important; outline-offset: 3px !important; }
    .__agora-marquee { position: fixed; z-index: 2147483646; border: 2px dashed #6d5efc; background: rgba(109, 94, 252, .12); pointer-events: none; border-radius: 4px; }
    .__agora-area { position: absolute; z-index: 2147483645; border: 2px solid #f5a524; background: rgba(245, 165, 36, .1); pointer-events: none; border-radius: 6px; }
    .__agora-pin { position: absolute; z-index: 2147483646; min-width: 22px; height: 22px; padding: 0 6px; box-sizing: border-box;
      border-radius: 11px 11px 11px 3px; background: #6d5efc; color: #fff; border: 2px solid #fff;
      font: 600 11px/18px system-ui, -apple-system, sans-serif; text-align: center; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); transform: translate(-4px, -16px); }
    .__agora-selected { outline: 2px solid #6d5efc !important; outline-offset: 2px !important; background-color: rgba(109, 94, 252, .08) !important; }
    .__agora-selection-box { position: absolute; z-index: 2147483644; border: 2px dashed #6d5efc; background: rgba(109, 94, 252, .06); pointer-events: none; border-radius: 6px; }
    .__agora-pin.is-changed { background: #c27c0e; }
    .__agora-pin:hover { transform: translate(-4px, -16px) scale(1.12); }
    html.__agora-commenting, html.__agora-commenting * { user-select: none !important; }
  `
  document.documentElement.appendChild(style)

  const stateListeners = new Set()
  const pendingRequests = new Map()
  let requestSeq = 0

  const stateRequest = ({ op, ...payload }) =>
    new Promise((resolve, reject) => {
      requestSeq += 1
      pendingRequests.set(requestSeq, { resolve, reject })
      post({ type: 'state-request', id: requestSeq, op, ...payload })
    })

  window.agora = Object.freeze({
    user: viewer,
    state: Object.freeze({
      get: (key, { scope = 'shared' } = {}) => stateRequest({ op: 'get', key, scope }),
      set: (key, value, { scope = 'shared' } = {}) => stateRequest({ op: 'set', key, value, scope }),
      delete: (key, { scope = 'shared' } = {}) => stateRequest({ op: 'delete', key, scope }),
      list: ({ scope = 'shared', prefix = '' } = {}) => stateRequest({ op: 'list', scope, prefix }),
      subscribe: (callback) => {
        stateListeners.add(callback)
        return () => stateListeners.delete(callback)
      },
    }),
  })

  const OVERLAY_CLASSES = new Set(['__agora-pin', '__agora-marquee', '__agora-area', '__agora-selection-box'])
  const isOverlayNode = (node) => node?.classList && [...node.classList].some((name) => OVERLAY_CLASSES.has(name))

  const normalize = (text) =>
    String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()

  const LABEL_ATTRIBUTES = ['alt', 'aria-label', 'placeholder', 'title']
  const textOf = (element) => normalize(element.innerText || LABEL_ATTRIBUTES.map((name) => element.getAttribute?.(name)).find(Boolean) || '').slice(0, 200)

  const cssPath = (element) => {
    if (element.id) return `#${CSS.escape(element.id)}`
    const parts = []
    let node = element
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`)
        return parts.join(' > ')
      }
      const tag = node.tagName.toLowerCase()
      const siblings = [...node.parentElement.children].filter((child) => child.tagName === node.tagName)
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag)
      node = node.parentElement
    }
    parts.unshift('body')
    return parts.join(' > ')
  }

  const describeTarget = (element) => ({ selector: cssPath(element), tag: element.tagName.toLowerCase(), text: textOf(element) })

  const toDocRect = (rect) => ({ x: Math.round(rect.left + scrollX), y: Math.round(rect.top + scrollY), w: Math.round(rect.width), h: Math.round(rect.height) })

  const find = (selector) => {
    try {
      return document.querySelector(selector)
    } catch {
      return null
    }
  }

  const resolveTarget = (target) => {
    const direct = find(target.selector)
    const tagMatches = (element) => !target.tag || element.tagName.toLowerCase() === target.tag
    if (direct && tagMatches(direct) && (!target.text || textOf(direct) === target.text)) return { element: direct, status: 'found' }
    if (target.text && target.tag) {
      const moved = [...document.getElementsByTagName(target.tag)].find((element) => !isOverlayNode(element) && textOf(element) === target.text)
      if (moved) return { element: moved, status: 'moved' }
    }
    if (direct && tagMatches(direct)) return { element: direct, status: 'changed' }
    return { element: null, status: 'missing' }
  }

  const resolveAnchor = (anchor) => {
    const results = (anchor?.targets ?? []).map(resolveTarget)
    const elements = results.map((result) => result.element).filter(Boolean)
    if (!elements.length) return { elements, status: 'missing' }
    if (elements.length < results.length) return { elements, status: 'partial' }
    return { elements, status: results.some((result) => result.status === 'changed') ? 'changed' : 'found' }
  }

  const unionRect = (elements) => {
    const rects = elements.map((element) => element.getBoundingClientRect())
    const left = Math.min(...rects.map((rect) => rect.left))
    const top = Math.min(...rects.map((rect) => rect.top))
    const right = Math.max(...rects.map((rect) => rect.right))
    const bottom = Math.max(...rects.map((rect) => rect.bottom))
    return { left, top, right, bottom, width: right - left, height: bottom - top }
  }

  const clearHover = () => {
    hovered?.classList.remove('__agora-hover')
    hovered = null
  }

  const setMode = (on) => {
    commentMode = on
    document.documentElement.classList.toggle('__agora-commenting', on)
    if (!on) {
      clearHover()
      drag?.marquee?.remove()
      drag = null
    }
  }

  const clearHighlight = () => {
    document.querySelectorAll('.__agora-selected').forEach((element) => element.classList.remove('__agora-selected'))
    document.querySelectorAll('.__agora-selection-box').forEach((box) => box.remove())
  }

  const placeBox = ({ top, left, width, height }) => {
    const box = document.createElement('div')
    box.className = '__agora-selection-box'
    Object.assign(box.style, { top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` })
    document.body?.appendChild(box)
  }

  const renderHighlight = () => {
    clearHighlight()
    const anchor = highlight.hover ?? highlight.selection
    if (!anchor) return
    const { elements } = resolveAnchor(anchor)
    elements.forEach((element) => element.classList.add('__agora-selected'))
    if (anchor.mode !== 'area') return
    const drawnRect = !highlight.hover && anchor.rect
    if (drawnRect) return placeBox({ top: anchor.rect.y, left: anchor.rect.x, width: anchor.rect.w, height: anchor.rect.h })
    if (!elements.length) return
    const rect = unionRect(elements)
    placeBox({ top: rect.top + scrollY - 6, left: rect.left + scrollX - 6, width: rect.width + 12, height: rect.height + 12 })
  }

  const renderPins = () => {
    document.querySelectorAll('.__agora-pin').forEach((pin) => pin.remove())
    const results = pins.map((pin) => {
      const { elements, status } = resolveAnchor(pin.anchor)
      if (!elements.length) return { id: pin.id, status }
      const rect = unionRect(elements)
      const badge = document.createElement('div')
      badge.className = `__agora-pin${status === 'changed' ? ' is-changed' : ''}`
      badge.textContent = pin.label
      badge.title = pin.preview || ''
      badge.style.top = `${rect.top + scrollY}px`
      badge.style.left = `${Math.min(rect.right + scrollX, document.documentElement.scrollWidth - 28)}px`
      badge.addEventListener('click', (event) => {
        event.stopPropagation()
        post({ type: 'open', id: pin.id })
      })
      document.body?.appendChild(badge)
      return { id: pin.id, status }
    })
    post({ type: 'anchors', results })
  }

  const flash = ({ anchor, id }) => {
    const { elements } = resolveAnchor(anchor)
    if (!elements.length) {
      post({ type: 'focus-missing', id })
      return
    }
    const rect = unionRect(elements)
    window.scrollTo({ top: Math.max(0, rect.top + scrollY - innerHeight / 2 + rect.height / 2), behavior: 'smooth' })
    elements.forEach((element) => element.classList.add('__agora-flash'))
    const area = elements.length > 1 ? document.createElement('div') : null
    if (area) {
      area.className = '__agora-area'
      Object.assign(area.style, {
        top: `${rect.top + scrollY - 6}px`,
        left: `${rect.left + scrollX - 6}px`,
        width: `${rect.width + 12}px`,
        height: `${rect.height + 12}px`,
      })
      document.body.appendChild(area)
    }
    setTimeout(() => {
      elements.forEach((element) => element.classList.remove('__agora-flash'))
      area?.remove()
    }, 1800)
  }

  const elementsInside = (selection) => {
    const inside = [...document.body.querySelectorAll('*')].filter((element) => {
      if (SKIP_TAGS.has(element.tagName) || isOverlayNode(element)) return false
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) return false
      return rect.left >= selection.left && rect.right <= selection.right && rect.top >= selection.top && rect.bottom <= selection.bottom
    })
    const set = new Set(inside)
    return inside.filter((element) => {
      let parentNode = element.parentElement
      while (parentNode) {
        if (set.has(parentNode)) return false
        parentNode = parentNode.parentElement
      }
      return true
    })
  }

  const pickElement = (element) => {
    post({ type: 'pick', anchor: { mode: 'element', targets: [describeTarget(element)], rect: toDocRect(element.getBoundingClientRect()) } })
  }

  const pickArea = (selection) => {
    const found = elementsInside(selection)
    const centerElement = document.elementFromPoint(selection.left + selection.width / 2, selection.top + selection.height / 2)
    const elements = found.length ? found.slice(0, MAX_TARGETS) : [centerElement].filter(Boolean)
    if (!elements.length) return
    post({
      type: 'pick',
      anchor: {
        mode: elements.length > 1 ? 'area' : 'element',
        targets: elements.map(describeTarget),
        rect: toDocRect(selection),
      },
    })
  }

  addEventListener('message', (event) => {
    const data = event.data
    if (!data?.agora || event.source !== parent) return
    if (data.type === 'mode') setMode(data.on)
    if (data.type === 'pins') {
      pins = data.pins
      renderPins()
    }
    if (data.type === 'focus') flash({ anchor: data.anchor, id: data.id })
    if (data.type === 'selection' || data.type === 'hover') {
      highlight[data.type] = data.anchor ?? null
      renderHighlight()
    }
    if (data.type === 'state-response') {
      const pending = pendingRequests.get(data.id)
      if (!pending) return
      pendingRequests.delete(data.id)
      if (data.ok) pending.resolve(data.value)
      else pending.reject(new Error(data.error))
    }
    if (data.type === 'state-changed') {
      const detail = { key: data.key, scope: data.scope, value: data.value, deleted: data.deleted, by: data.by }
      stateListeners.forEach((callback) => callback(detail))
      dispatchEvent(new CustomEvent('agora:state', { detail }))
    }
  })

  document.addEventListener(
    'mouseover',
    (event) => {
      if (!commentMode || drag?.marquee || isOverlayNode(event.target)) return
      clearHover()
      hovered = event.target
      hovered.classList.add('__agora-hover')
    },
    true,
  )

  document.addEventListener(
    'mousedown',
    (event) => {
      if (!commentMode || event.button !== 0 || isOverlayNode(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      drag = { x: event.clientX, y: event.clientY, target: event.target, marquee: null }
    },
    true,
  )

  document.addEventListener(
    'mousemove',
    (event) => {
      if (!drag) return
      const width = Math.abs(event.clientX - drag.x)
      const height = Math.abs(event.clientY - drag.y)
      if (!drag.marquee && Math.max(width, height) < DRAG_THRESHOLD) return
      if (!drag.marquee) {
        clearHover()
        drag.marquee = document.createElement('div')
        drag.marquee.className = '__agora-marquee'
        document.body.appendChild(drag.marquee)
      }
      Object.assign(drag.marquee.style, {
        left: `${Math.min(event.clientX, drag.x)}px`,
        top: `${Math.min(event.clientY, drag.y)}px`,
        width: `${width}px`,
        height: `${height}px`,
      })
    },
    true,
  )

  document.addEventListener(
    'mouseup',
    (event) => {
      if (!drag) return
      event.preventDefault()
      event.stopPropagation()
      const { marquee, target } = drag
      if (marquee) {
        const rect = marquee.getBoundingClientRect()
        marquee.remove()
        pickArea({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height })
      } else {
        pickElement(target)
      }
      suppressClick = true
      setTimeout(() => {
        suppressClick = false
      }, 400)
      setMode(false)
    },
    true,
  )

  document.addEventListener(
    'click',
    (event) => {
      if (!commentMode && !suppressClick) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    },
    true,
  )

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && commentMode) {
      setMode(false)
      post({ type: 'cancel' })
    }
  })

  let scrollTimer = null
  addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => post({ type: 'scroll', y: Math.round(scrollY) }), 120)
    },
    { passive: true },
  )

  let resizeTimer = null
  addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      renderPins()
      renderHighlight()
    }, 150)
  })

  const restore = () => {
    if (initialScroll) scrollTo(0, initialScroll)
    post({ type: 'ready' })
  }
  if (document.readyState === 'complete') restore()
  else addEventListener('load', restore)
})()
