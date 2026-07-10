import { effect } from './effect.ts'
import { clientPage } from './runtime/clientPage.ts'
import { historyEntries } from './runtime/historyEntries.ts'
import { liveScopes } from './runtime/liveScopes.ts'
import { PATCH_BUS } from './runtime/PATCH_BUS.ts'
import { runtimePath } from './runtime/runtimePath.ts'

/* Same-origin cross-tab channel the inspector page listens on. The app tab
   publishes scope + router state; the inspector subscribes. Web-standard, so no
   server route or buffer is involved — core publishes, the package consumes. */
const CHANNEL = 'abide:inspector'

/* Coalesce a burst of patches into one snapshot — the post is the cost, the read is cheap. */
const SNAPSHOT_DEBOUNCE_MS = 60

/* JSON round-trip to strip anything structured-clone can't carry (functions,
   class instances, DOM nodes) before postMessage, degrading to undefined rather
   than throwing into the channel. */
function cloneable(value: unknown): unknown {
    try {
        return JSON.parse(JSON.stringify(value))
    } catch {
        return undefined
    }
}

/* The live scope forest as a flat list — the inspector rebuilds the tree from
   each node's `parent` id (the Scope surface exposes no children accessor). */
function scopeNodes(): Array<{
    id: string
    label: string | undefined
    parent: string | undefined
    state: unknown
}> {
    return Array.from(liveScopes.scopes, (scope) => ({
        id: scope.id,
        label: scope.label,
        parent: scope.parent?.id,
        state: cloneable(scope.snapshot()),
    }))
}

/* Router state off the existing reactive holders — read, not subscribed, here;
   the nav effect drives re-reads. */
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
Installs the client→inspector bridge: a BroadcastChannel the inspector page reads
to render its Reactive + Router tabs. Gated by `__abideInspect` (server-injected
only when the inspector is enabled) and called from startClient before the router
builds any scope — so registration is armed before the first scope exists. A
no-op where BroadcastChannel is absent (SSR, old runtimes). Mirrors
installHotBridge: dev instrumentation, not public surface.
*/
export function installInspectorBridge(): void {
    /* No BroadcastChannel means no consumer for the scope registry — bail before
       arming `liveScopes.enabled`, so createScope never pays scope tracking for a
       set nothing reads. */
    if (typeof BroadcastChannel === 'undefined') {
        return
    }
    liveScopes.enabled = true
    const channel = new BroadcastChannel(CHANNEL)
    const tab = typeof crypto !== 'undefined' ? crypto.randomUUID() : String(performance.now())
    const post = (message: object) => {
        try {
            channel.postMessage({ tab, ...message })
        } catch {
            /* A non-cloneable slipped through despite the JSON pass — drop the frame
               rather than throw into a patch/nav handler. */
        }
    }

    const announce = () =>
        post({
            kind: 'announce',
            url: typeof location !== 'undefined' ? location.href : '',
            app: typeof document !== 'undefined' ? document.title : '',
        })
    const sendSnapshot = () =>
        post({ kind: 'snapshot', scopes: scopeNodes(), router: routerState() })

    let snapshotTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleSnapshot = () => {
        clearTimeout(snapshotTimer)
        snapshotTimer = setTimeout(sendSnapshot, SNAPSHOT_DEBOUNCE_MS)
    }

    /* Inspector handshakes: `hello` (it just opened — everyone re-announce + push)
       and `request` (it wants a fresh snapshot of this tab). */
    channel.onmessage = (event) => {
        const message = event.data as { kind?: string; tab?: string }
        if (message.kind === 'hello') {
            announce()
            sendSnapshot()
        } else if (message.kind === 'request' && message.tab === tab) {
            sendSnapshot()
        }
    }

    /* Every doc mutation flows through PATCH_BUS; forward the patch as a live
       mutation event and re-snapshot (debounced) so values stay current. */
    PATCH_BUS.subscribe((patchEvent) => {
        post({ kind: 'patch', op: patchEvent.patch.op, path: patchEvent.patch.path })
        scheduleSnapshot()
    })

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
    /* First snapshot once the router has built the initial scope tree (this runs
       before router()). */
    setTimeout(sendSnapshot, 0)
}
