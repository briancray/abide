import { effect } from './effect.ts'
import { clientPage } from './runtime/clientPage.ts'
import { historyEntries } from './runtime/historyEntries.ts'
import { runtimePath } from './runtime/runtimePath.ts'

/* Same-origin cross-tab channel the inspector page listens on. The app tab publishes
   router state; the inspector subscribes. Web-standard, so no server route or buffer is
   involved — core publishes, the package consumes. */
const CHANNEL = 'abide:inspector'

/* Router state off the existing reactive holders — read, not subscribed, here; the nav
   effect drives re-reads. */
function routerState() {
    const page = clientPage.value
    return {
        path: runtimePath.value,
        route: page.route,
        /* `page.params` is a reactive Proxy — structuredClone (postMessage) can't carry
           a Proxy and throws, dropping every router frame. Spread to a plain object. */
        params: { ...page.params },
        navigating: page.navigating,
        url: page.url.href,
        entry: historyEntries.current,
    }
}

/*
Installs the client→inspector bridge: a BroadcastChannel the inspector page reads to render
its Router tab. Gated by `__abideInspect` (server-injected only when the inspector is
enabled) and called from startClient before the router builds any scope. A no-op where
BroadcastChannel is absent (SSR, old runtimes). Dev instrumentation, not public surface.
*/
export function installInspectorBridge(): void {
    if (typeof BroadcastChannel === 'undefined') {
        return
    }
    const channel = new BroadcastChannel(CHANNEL)
    const tab = typeof crypto !== 'undefined' ? crypto.randomUUID() : String(performance.now())
    const post = (message: object) => {
        try {
            channel.postMessage({ tab, ...message })
        } catch {
            /* A non-cloneable slipped through — drop the frame rather than throw into a
               nav handler. */
        }
    }

    const announce = () =>
        post({
            kind: 'announce',
            url: typeof location !== 'undefined' ? location.href : '',
            app: typeof document !== 'undefined' ? document.title : '',
        })
    const sendSnapshot = () => post({ kind: 'snapshot', router: routerState() })

    /* Inspector handshakes: `hello` (it just opened — everyone re-announce + push) and
       `request` (it wants a fresh snapshot of this tab). */
    channel.onmessage = (event) => {
        const message = event.data as { kind?: string; tab?: string }
        if (message.kind === 'hello') {
            announce()
            sendSnapshot()
        } else if (message.kind === 'request' && message.tab === tab) {
            sendSnapshot()
        }
    }

    /* Reading the page + path States tracks them, so this re-runs on navigation. */
    effect(() => {
        clientPage.value
        runtimePath.value
        post({ kind: 'nav', router: routerState() })
    })

    if (typeof addEventListener === 'function') {
        addEventListener('pagehide', () => {
            post({ kind: 'bye' })
            channel.close()
        })
    }

    announce()
    setTimeout(sendSnapshot, 0)
}
