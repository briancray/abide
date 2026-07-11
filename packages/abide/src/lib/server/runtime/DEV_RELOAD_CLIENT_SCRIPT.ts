/*
Dev-only live-reload client, injected into the served shell when the server
runs under `abide dev`. It opens an EventSource to /__abide/dev; each
connection's first event carries the worker's reload stamp — `{ structure,
cssHref }` (devClientFingerprint). The channel only drops when the dev
orchestrator swaps the server after a rebuild, and on reconnect:
  - `structure` changed → reload (any non-CSS edit).
  - only `cssHref` changed → swap the entry stylesheet's `<link>` in place,
    so a CSS edit restyles the live page with no reload and no state loss.
  - both equal (server-only edit) → keep the page alive.
Self-managed retry keeps the first reconnect fast (250ms) so a rebuild swap
recovers quickly, then backs off exponentially up to a 5s cap — a server that
stays down (dev stopped) settles to one attempt every 5s instead of flooding
the network, and still reconnects on its own if the server comes back. The
backoff resets once a connection opens.

Hidden tabs hold no connection: the channel closes on `visibilitychange:
hidden` and reopens on visible, where the reconnect's first event carries
whatever the current worker announces — a rebuild that happened while the tab
slept still reloads it. The initial connect runs even when the page loads
hidden (the baseline must be the serving worker's stamp, captured before a swap
can replace it) and releases itself once that first event lands.
*/
import { DEV_RELOAD_PATH } from '../../shared/DEV_RELOAD_PATH.ts'

export const DEV_RELOAD_CLIENT_SCRIPT = `<script>
;(() => {
  let stamp
  let source
  let retryTimer
  let retryDelay = 250
  function disconnect() {
    clearTimeout(retryTimer)
    if (source) {
      source.close()
      source = undefined
    }
  }
  function swapCss(href) {
    const links = document.querySelectorAll('link[rel="stylesheet"]')
    for (const link of links) {
      const current = link.getAttribute('href') || ''
      if (current.indexOf('/_app/') !== -1 && current.slice(-4) === '.css') {
        link.href = href
        return
      }
    }
  }
  function connect() {
    if (source) {
      return
    }
    source = new EventSource('${DEV_RELOAD_PATH}')
    source.onopen = () => {
      retryDelay = 250
    }
    source.onmessage = (event) => {
      const next = JSON.parse(event.data)
      if (stamp === undefined) {
        stamp = next
        if (document.hidden) {
          disconnect()
        }
        return
      }
      if (next.structure !== stamp.structure) {
        location.reload()
        return
      }
      if (next.cssHref && next.cssHref !== stamp.cssHref) {
        swapCss(next.cssHref)
      }
      stamp = next
    }
    source.onerror = () => {
      disconnect()
      if (!document.hidden) {
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 5000)
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
