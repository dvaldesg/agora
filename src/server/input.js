import { HttpError } from './http.js'

const MAX_ANCHOR_TARGETS = 30

const clip = ({ value, max }) => String(value ?? '').slice(0, max)

export const cleanName = ({ value }) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40) || 'anonymous'

export const cleanTitle = ({ title }) =>
  String(title ?? '')
    .trim()
    .slice(0, 120) || 'Untitled'

const cleanRect = ({ rect }) => {
  if (!rect || !['x', 'y', 'w', 'h'].every((key) => Number.isFinite(rect[key]))) return null
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }
}

export const cleanAnchor = ({ anchor }) => {
  if (!anchor || !Array.isArray(anchor.targets) || !anchor.targets.length) return null
  const targets = anchor.targets.slice(0, MAX_ANCHOR_TARGETS).map((target) => ({
    selector: clip({ value: target.selector, max: 600 }),
    tag: clip({ value: target.tag, max: 24 }).toLowerCase(),
    text: clip({ value: target.text, max: 200 }),
  }))
  if (targets.some((target) => !target.selector)) throw new HttpError({ status: 400, message: 'every anchor target needs a selector' })
  return { mode: anchor.mode === 'area' || targets.length > 1 ? 'area' : 'element', targets, rect: cleanRect({ rect: anchor.rect }) }
}

export const stripHtml = ({ artifact }) => {
  const { html, ...meta } = artifact
  return meta
}
