// CLIENT PAGE BOOTSTRAP (M3b; PR7 AOT client cutover) — abide-compiler C2 (hydration entry).
//
// The client bundle's entry (built by clientBundle.ts) calls `bootstrapPage(hydrate, rpcSpecs)` on
// load, where `hydrate` is the page's AOT-emitted client hydrate. In the browser this synthesizes the
// client RPC proxies (the module-swap of rpc-core §6 — the same cell surface a page imported on the
// server, now backed by fetch), builds the injected `$scope` (RPC proxies + framework bindings the
// emitted code reads by import local name), and hydrates (claims) the SSR'd page in `#__abide-app`.
//
// PR7: the emitted mount is compiled at BUILD time (`emitModuleSource`), so the browser never parses
// `.abide` source or drags the TypeScript compiler in — this file imports no TS7 surface. The scope
// it builds mirrors the SSR scope (`server/internal/pages.ts`): the RPC proxies plus `state`/`watch`/
// `props` and the isomorphic `route`/`url`/`navigate`, each keyed by the local name the page imports.
//
// PR7 (Stage 2): this is now true attach-hydration (C2). Instead of clearing `#__abide-app` and
// mounting fresh, `bootstrapPage` calls the page's emitted `hydrate`, which CLAIMS the SSR DOM in
// place (same nodes, no container clear, suppress the initial reactive write). The emitted `hydrate`
// whole-page-falls-back to a fresh `mount` internally if the root structure is unrecoverable, so
// hydration never leaves the page corrupted. Both first load and soft-nav share this one path.
//
// The §5 hydration seed comes from the `#__abide-seed` script on first load, or from the soft-nav
// envelope (passed as `seedOverride`) on subsequent navigations. Its `reads` are replayed into the
// client RPC cells BEFORE mount, so an SSR-computed read resolves from cache instead of re-fetching;
// any remaining keys become mount props.

import type { HydrationSeed } from '../../server/internal/pages.ts'
import { route } from '../../shared/route.ts'
import { url } from '../../shared/url.ts'
import { disposeActive, handlePopState, isKnownPage, mountPathname, navigate } from '../navigate.ts'
import { watch } from '../watch.ts'
import { makeClientImports } from './clientProxy.ts'
import { type PageLoader, type PageMount, type RpcSpecs, registerPages } from './pageRegistry.ts'
import { beginStreamHandoff, endStreamHandoff, isHydrating } from './runtime.ts'
import { makeSeededState } from './seededState.ts'

const CONTAINER_ID = '__abide-app'
const SEED_ID = '__abide-seed'

// Read the hydration seed (recorded reads + any props) from the inline `#__abide-seed` script. Empty
// `{}` when absent or unparseable — a malformed seed degrades to a plain fetch-on-read mount.
function readSeed(): HydrationSeed {
    const script = document.getElementById(SEED_ID)
    if (script === null) return {}
    const text = script.textContent ?? ''
    if (text.trim() === '') return {}
    try {
        const parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object') return parsed as HydrationSeed
    } catch {
        // Malformed seed — fall back to an empty seed rather than failing the mount.
    }
    return {}
}

// Replay the seed's recorded SSR reads into the client RPC cells so a matching read resolves from
// cache instead of re-fetching. Unknown RPC names and malformed records are skipped defensively.
function replayReads(seed: HydrationSeed, imports: Record<string, unknown>): void {
    const reads = seed.reads
    if (!Array.isArray(reads)) return
    for (const record of reads) {
        if (record === null || typeof record !== 'object') continue
        const proxy = imports[record.name] as
            | { seed?: (args: unknown, value: unknown) => void }
            | undefined
        if (proxy !== undefined && typeof proxy.seed === 'function') {
            proxy.seed(record.args, record.value)
        }
    }
}

// Bootstrap a page in the browser from its AOT-emitted client `hydrate`. Returns a cleanup function
// that disposes the mount (unmounts effects). A no-op outside the browser (no `document`), so
// importing the entry under SSR is safe. `hydrate` claims the server DOM; on an unrecoverable root
// mismatch it fresh-mounts internally.
export function bootstrapPage(
    hydrate: PageMount,
    rpcSpecs: Record<string, { method: string; read: boolean; shared?: boolean }>,
    base?: string,
    seedOverride?: HydrationSeed,
): () => void {
    if (typeof document === 'undefined') return () => {}

    const container = document.getElementById(CONTAINER_ID)
    if (container === null) return () => {}

    // First load reads the inline seed script; a soft-nav passes its envelope seed as `seedOverride`
    // (the inline script is stale after the initial document).
    const seed = seedOverride ?? readSeed()
    const imports = makeClientImports(rpcSpecs, base)
    // Replay recorded reads into the RPC cells BEFORE mount so the component resolves them from cache.
    // The emitted mount reads these SAME proxy instances off `$scope`, so a seeded read never re-fetches.
    replayReads(seed, imports)
    // Remaining seed keys (not the recorded reads) become mount props.
    const { reads: _reads, ...props } = seed
    // Isomorphic runtime bindings a page may `import` and call (`route()`, `url()`, `navigate()`). On
    // the client `route()` reads the reactive client-route holder (set by bootstrap/soft-nav) so it
    // re-renders on nav. SERVER-ONLY accessors (identity/request/cookies) are absent here — importing
    // one on the client resolves to undefined, so a page that uses them is server-render-only.
    imports.route = route
    imports.url = url
    imports.navigate = navigate

    // The merged `$scope` the emitted mount reads: RPC proxies + the framework bindings, each keyed by
    // the local name the page imports (mirrors the SSR scope in server/internal/pages.ts). `props` is
    // this instance's props behind the `props()` import. `state` is the seed-replaying wrapper: its
    // ordinal counter is created here, so it resets per mount and consumes `seed.states` in call order.
    const scope: Record<string, unknown> = {
        ...imports,
        state: makeSeededState(seed, isHydrating),
        watch,
        props: () => props,
    }

    // Install the §5 stream-attach handoffs (`seed.streams`) BEFORE hydrate so a `{#for await}` over a
    // known-RPC source adopts/resumes its seeded transcript instead of re-invoking the source. Cleared
    // after the (synchronous) hydrate pass — an in-flight mode-B resume already captured its handle.
    beginStreamHandoff(seed.streams, base ?? '')
    // Attach-hydration (Stage 2, PR7): CLAIM the SSR DOM in place — no container clear. The emitted
    // `hydrate` seeds its cursor from the server DOM, claims each node (suppressing the initial write —
    // the server already rendered the seeded value), and whole-page-falls-back to a fresh mount if the
    // root structure is unrecoverable.
    try {
        return hydrate(container, scope)
    } finally {
        endStreamHandoff()
    }
}

// Left-click on a same-origin internal link, without modifier keys / new-tab intent — the click a
// soft-nav should intercept. Returns the resolved same-origin URL to navigate to, or null to let the
// browser handle it (external link, download, target=_blank, modified click, etc.).
function softNavTarget(event: MouseEvent): URL | null {
    if (event.defaultPrevented) return null
    if (event.button !== 0) return null
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null

    const eventTarget = event.target
    if (!(eventTarget instanceof Element)) return null
    const anchor = eventTarget.closest('a')
    if (anchor === null) return null
    if (anchor.hasAttribute('download')) return null

    const target = anchor.getAttribute('target')
    if (target !== null && target !== '' && target !== '_self') return null

    const rel = anchor.getAttribute('rel')
    if (rel !== null && /(^|\s)external(\s|$)/.test(rel)) return null

    const href = anchor.getAttribute('href')
    if (href === null || href.startsWith('#')) return null

    const resolved = new URL(href, location.href)
    if (resolved.origin !== location.origin) return null
    // Only intercept links to real in-app PAGES. Non-page same-origin links (/openapi.json, /rpc/*,
    // /__abide/*, static files) must fall through to a normal browser navigation — intercepting them
    // pushState's a URL abide can't render and pollutes history (breaking Back).
    if (!isKnownPage(resolved.pathname)) return null
    return resolved
}

function onDocumentClick(event: MouseEvent): void {
    const resolved = softNavTarget(event)
    if (resolved === null) return
    event.preventDefault()
    void navigate(resolved.pathname + resolved.search + resolved.hash)
}

// Boot the whole app client-side: register the page map + RPC specs, hydrate the page matching the
// current location (claiming the SSR'd HTML in place), and install the global link-click interceptor +
// back/forward (popstate) handler so in-app navigation stays a soft-nav. Returns a cleanup that
// removes the listeners. A no-op outside the browser.
export function bootstrapApp(
    loaders: Record<string, PageLoader>,
    rpcSpecs: RpcSpecs,
    base?: string,
): () => void {
    if (typeof document === 'undefined') return () => {}
    registerPages(loaders, rpcSpecs, base)
    // `mountPathname` is async now (it imports the current route's code-split chunk); the SSR HTML is
    // already visible, so hydration completes a tick later once the chunk loads. A load failure leaves
    // the page as server-rendered (non-interactive) — graceful degradation, no reload loop.
    void mountPathname(location.pathname + location.search)
    // Bare (window-level) listeners: click for link interception, popstate for back/forward.
    addEventListener('click', onDocumentClick as EventListener)
    addEventListener('popstate', handlePopState)
    return () => {
        removeEventListener('click', onDocumentClick as EventListener)
        removeEventListener('popstate', handlePopState)
        disposeActive()
    }
}
