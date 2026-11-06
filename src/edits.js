export class EditError extends Error {}

export function applyEdits({ html, edits }) {
  return edits.reduce((current, { old_str: oldStr, new_str: newStr }, index) => {
    const first = oldStr ? current.indexOf(oldStr) : -1
    if (first === -1) throw new EditError(`edit ${index}: old_str not found`)
    if (current.indexOf(oldStr, first + 1) !== -1) {
      throw new EditError(`edit ${index}: old_str occurs more than once, add more context`)
    }
    return current.slice(0, first) + newStr + current.slice(first + oldStr.length)
  }, html)
}
