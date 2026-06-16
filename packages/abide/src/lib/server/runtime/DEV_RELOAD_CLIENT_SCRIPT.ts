/*
Dev-only live-reload client, injected into the served shell when the server
runs under `abide dev`. It opens an EventSource to /__abide/dev; each
connection's first event carries the worker's client fingerprint — everything
the browser consumes (devClientFingerprint). The channel only drops when the
dev orchestrator swaps the server after a rebuild, and on reconnect the page
reloads only if the fingerprint changed: a server-only edit keeps the page,
and its UI state, alive. Self-managed retry keeps the gap short instead of
relying on EventSource's multi-second default backoff.

Hidden tabs hold no connection: the channel closes on `visibilitychange:
hidden` and reopens on visible, where the reconnect's first event carries
whatever the current worker announces — a rebuild that happened while the tab
slept still reloads it. The initial connect runs even when the page loads
hidden (the baseline must be the serving worker's fingerprint, captured before
a swap can replace it) and releases itself once that first event lands.
*/
import { DEV_RELOAD_PATH } from '../../shared/DEV_RELOAD_PATH.ts'

export const DEV_RELOAD_CLIENT_SCRIPT = `<script>
;(() => {
  let fingerprint
  let source
  let retryTimer
  function disconnect() {
    clearTimeout(retryTimer)
    if (source) {
      source.close()
      source = undefined
    }
  }
  function connect() {
    if (source) {
      return
    }
    source = new EventSource('${DEV_RELOAD_PATH}')
    source.onmessage = (event) => {
      if (fingerprint === undefined) {
        fingerprint = event.data
        if (document.hidden) {
          disconnect()
        }
        return
      }
      if (event.data !== fingerprint) {
        location.reload()
      }
    }
    source.onerror = () => {
      disconnect()
      if (!document.hidden) {
        retryTimer = setTimeout(connect, 250)
      }
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      disconnect()
    } else {
      connect()
    }
  })
  connect()
})()
</script>`
