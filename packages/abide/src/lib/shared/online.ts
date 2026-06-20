import { createSubscriber } from './createSubscriber.ts'
import { requestScopeSlot } from './requestScopeSlot.ts'

/*
Reactive network-connectivity probe in the pending()/refreshing() family:
reading it from a $derived/$effect re-runs that scope when the browser's
online/offline events fire. navigator.onLine's *offline* signal is reliable
(a true network loss always reports); its online value can false-positive
behind captive portals — verified backend reachability is a separate,
opt-in concern (the bundle launcher's liveness watch owns it for bundles).

On the server it reflects the *calling client's* reported connectivity — the
OFFLINE_HEADER a abide RPC fetch stamps while offline (read off the request
scope). In a bundle the client and embedded server share a machine, so this is
exactly the outbound reachability a handler reaching external sites needs:
`if (!online()) return error(503)` skips a doomed fetch. True outside any
request scope (boot, cron) and for non-abide-client requests (no header).

It answers "did the calling client report itself offline," NOT "can this
server reach the internet." So during SSR it is always true: the initial
render is a browser document navigation abide didn't issue, carrying no
header — there's been no client round-trip to report connectivity yet. Gate
external fetches on online() in the RPC/handler path (a real client called),
not in SSR; in SSR bound the fetch with AbortSignal.timeout instead, or defer
the read to the hydrated client where navigator.onLine is live. Bundles feel
this most — localhost serves the SSR even with the machine offline.

Reports, never acts — reading this opens no fetch and no stream.
*/
const subscribeOnline =
    typeof window === 'undefined'
        ? undefined
        : createSubscriber((update) => {
              const changed = () => update()
              window.addEventListener('online', changed)
              window.addEventListener('offline', changed)
              return () => {
                  window.removeEventListener('online', changed)
                  window.removeEventListener('offline', changed)
              }
          })

// @documentation probes
export function online(): boolean {
    /* window, not navigator: Bun defines a partial navigator with no onLine. */
    if (typeof window === 'undefined') {
        return requestScopeSlot.resolver?.()?.online ?? true
    }
    subscribeOnline?.()
    return navigator.onLine
}
