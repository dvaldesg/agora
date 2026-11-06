import { describeEvent } from '../format.js'
import { isRelevant } from '../relevance.js'

const HOOK_TIMEOUT_MS = 5000

export function createBus({ store }) {
  const streams = new Set()
  const waiters = new Set()

  const broadcast = ({ data }) => {
    const frame = `data: ${JSON.stringify(data)}\n\n`
    for (const stream of streams) stream.write(frame)
  }

  const deliverHooks = ({ event }) => {
    store
      .listHooks()
      .filter((hook) => isRelevant({ event, agent: hook.name }))
      .forEach((hook) => {
        fetch(hook.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-agora-event': event.type },
          body: JSON.stringify({ agent: hook.name, text: describeEvent({ event }), event }),
          signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
        }).catch((error) => console.error(`agora: hook ${hook.id} (${hook.url}) failed: ${error.message}`))
      })
  }

  const emit = (event) => {
    const stored = store.appendEvent(event)
    broadcast({ data: stored })
    for (const wake of waiters) wake()
    deliverHooks({ event: stored })
    return stored
  }

  const waitForWake = ({ ms }) =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      waiters.add(done)
    })

  const poll = async ({ since, filter, timeout }) => {
    const deadline = Date.now() + timeout
    let cursor = since
    while (true) {
      const batch = store.eventsSince({ since: cursor })
      if (batch.length) cursor = batch.at(-1).seq
      const events = batch.filter(filter)
      const remaining = deadline - Date.now()
      if (events.length || remaining <= 0) return { events, cursor }
      if (batch.length) continue
      await waitForWake({ ms: remaining })
    }
  }

  const attach = ({ stream }) => {
    streams.add(stream)
    return () => streams.delete(stream)
  }

  return { emit, broadcast, poll, attach }
}
