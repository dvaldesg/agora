import { api } from './api.js'
import { postToFrame } from './frame.js'
import { state } from './store.js'

const statePath = () => `/api/artifacts/${state.currentId}/state`

const who = () => `as=${encodeURIComponent(state.name)}`

const operations = {
  get: ({ scope, data }) => api({ path: `${statePath()}?scope=${scope}&key=${encodeURIComponent(data.key)}&${who()}` }).then((result) => result.value),
  list: ({ scope, data }) =>
    api({ path: `${statePath()}?scope=${scope}&prefix=${encodeURIComponent(data.prefix ?? '')}&${who()}` }).then((result) => result.items),
  set: ({ scope, data }) =>
    api({ path: `${statePath()}/${encodeURIComponent(data.key)}`, method: 'PUT', body: { value: data.value ?? null, scope, author: state.name } }).then(
      (result) => result.value,
    ),
  delete: ({ scope, data }) =>
    api({ path: `${statePath()}/${encodeURIComponent(data.key)}?scope=${scope}&${who()}`, method: 'DELETE' }).then((result) => result.deleted),
}

export const handleStateRequest = async ({ data }) => {
  const reply = (result) => postToFrame({ message: { type: 'state-response', id: data.id, ...result } })
  try {
    const operation = operations[data.op]
    if (!operation || !state.currentId) throw new Error(`unsupported state operation ${data.op}`)
    if (data.op !== 'list' && !data.key) throw new Error('key is required')
    reply({ ok: true, value: await operation({ scope: data.scope === 'user' ? 'user' : 'shared', data }) })
  } catch (error) {
    reply({ ok: false, error: error.message })
  }
}

export const forwardStateChange = async ({ event }) => {
  const { key, scope, owner, deleted } = event.payload
  if (scope === 'user' && owner !== state.name) return
  const needsFetch = scope === 'user' && !deleted
  const value = needsFetch ? await operations.get({ scope, data: { key } }) : event.payload.value
  postToFrame({ message: { type: 'state-changed', key, scope, value: deleted ? null : value, deleted, by: event.actor } })
}
