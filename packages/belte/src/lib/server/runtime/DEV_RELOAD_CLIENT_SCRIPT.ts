/*
Dev-only live-reload client, injected into the served shell when the server
runs under `belte dev`. It opens an EventSource to /__belte/dev and reloads on
*reconnect*: the channel only drops when the dev orchestrator restarts the
server after a rebuild, so re-establishing the connection is the signal that
fresh code is being served. The first open is the initial page load (no
reload); every open after that is a restart. Self-managed retry keeps the gap
short instead of relying on EventSource's multi-second default backoff.
*/
export const devReloadClientScript = `<script>
;(() => {
  let opened = false
  function connect() {
    const source = new EventSource('/__belte/dev')
    source.onopen = () => {
      if (opened) {
        location.reload()
        return
      }
      opened = true
    }
    source.onerror = () => {
      source.close()
      setTimeout(connect, 250)
    }
  }
  connect()
})()
</script>`
