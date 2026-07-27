// CLIENT PAGE BOOTSTRAP (M3b; PR7 AOT client cutover) — abide-compiler C2 (hydration entry).
//
// The client bundle's entry (built by clientBundle.ts) calls `bootstrapPage(hydrate, rpcSpecs)` on
// load, where `hydrate` is the page's AOT-emitted client hydrate. In the browser this synthesizes the
// client RPC proxies (the module-swap of rpc-core §6 — the same memo surface a page imported on the
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
// client RPC memos BEFORE mount, so an SSR-computed read resolves from cache instead of re-fetching;
// any remaining keys become mount props.

import { adoptTrace } from '../../shared/internal/adoptTrace.ts'
import { decodeStreamResponse } from '../../shared/internal/decodeStreamResponse.ts'
import type { HydrationSeed } from '../../shared/internal/hydrationSeed.ts'
import { outgoingTraceparent } from '../../shared/internal/outgoingTraceparent.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { route } from '../../shared/route.ts'
import { url } from '../../shared/url.ts'
import { watch } from '../../shared/watch.ts'
import { disposeActive, handlePopState, isKnownPage, mountPathname, navigate } from '../navigate.ts'
import { makeClientImports } from './clientProxy.ts'
import {
    type PageLoader,
    type PageMount,
    type RpcSpecs,
    registerPages,
    type SocketSpecs,
} from './pageRegistry.ts'
import { isHydrating } from './runtime.ts'
import { makeSeededState } from './seededState.ts'
import { makeClientSocketImports } from './socketProxy.ts'

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

// Replay the seed's recorded SSR reads into the client RPC memos so a matching read resolves from
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

// Build the mode-B (OPEN handoff) TAIL for `seedStream`: RESUME over `GET …?__abide_from=<count>`
// (re-encoded in the handler's original encoding, decoded by content-type). The flushed prefix is NOT
// yielded here — it is handed to `seedStream` as `StreamSeed.prefix` and pushed synchronously, which is
// what lets attach-hydration claim the server's painted items in the same tick.
//
// If the server transcript was evicted the endpoint answers `x-abide-stream-resume: fresh` — a full run
// from 0 that REPLACES the prefix. The prefix is already in the transcript by then (and, worse, may
// already have been CLAIMED onto the server's DOM), so this cannot simply yield the fresh run on top:
// it calls `onFresh` and stops. That drops the slot, which re-runs the block's effect — a clean
// clear-and-restream, i.e. exactly today's behaviour, in the rare eviction case only.
// A failed/absent resume (offline, 4xx, no body) leaves the prefix standing and the slot closes; a later
// `refresh()` (now reactive) re-runs from scratch.
export async function* resumeStreamSource(
    base: string,
    name: string,
    args: unknown,
    count: number,
    onFresh: () => void,
): AsyncGenerator<unknown> {
    const argsQuery =
        args !== undefined
            ? `&${RPC_QUERY_PARAMS.args}=${encodeURIComponent(JSON.stringify(args))}`
            : ''
    let response: Response
    // A resume IS an RPC call (the same handler, continued), so it carries the trace like one — a
    // fresh span under the page's trace. `base` is the app's own origin here; a cross-origin base is
    // handled by the proxy's same-origin rule, and a resume of a cross-origin stream is not reachable.
    const traceparent = outgoingTraceparent()
    try {
        response = await fetch(
            `${base}/__abide/rpc/${name}?${RPC_QUERY_PARAMS.from}=${count}${argsQuery}`,
            traceparent === undefined ? undefined : { headers: { traceparent } },
        )
    } catch {
        return // prefix stands, slot closes
    }
    if (!response.ok || response.body === null) return
    // `fresh` = the retained transcript was gone, so this response is a full run from 0. The prefix it
    // replaces is already installed, so hand the whole slot back for a re-run rather than appending.
    if (response.headers.get('x-abide-stream-resume') === 'fresh') {
        onFresh()
        return
    }
    yield* decodeStreamResponse(response)
}

// Replay the seed's stream handoffs into the client RPC memos so an SSR-adopted `{#for await}` warms its
// memo without re-invoking the source, and `peek`/`chunks`/`done`/`refresh` all work on the adopted stream
// (§5). A COMPLETED (mode-A) handle seeds its inline transcript; an OPEN (mode-B) handle seeds a source
// that replays the flushed prefix then resumes the tail over `?__abide_from=<count>`. Unknown names / malformed
// records are skipped.
function replayStreams(seed: HydrationSeed, imports: Record<string, unknown>, base: string): void {
    const streams = seed.streams
    if (!Array.isArray(streams)) return
    for (const handle of streams) {
        if (handle === null || typeof handle !== 'object') continue
        if (handle.name === null || !Array.isArray(handle.values)) continue
        const proxy = imports[handle.name] as
            | {
                  seedStream?: (args: unknown, source: unknown) => void
                  invalidate?: (args: unknown) => void
              }
            | undefined
        if (proxy === undefined || typeof proxy.seedStream !== 'function') continue
        if (handle.done === true) {
            proxy.seedStream(handle.args, handle.values)
        } else {
            // Mode B: the flushed prefix is pushed SYNCHRONOUSLY (so the region can be claimed) and the
            // resume supplies only the tail. An evicted transcript (`fresh`) invalidates the slot instead,
            // dropping the claimed region for a clean re-stream — the prefix it would replace is already in.
            const args = handle.args
            proxy.seedStream(args, {
                prefix: handle.values,
                rest: resumeStreamSource(base, handle.name, args, handle.count, () => {
                    proxy.invalidate?.(args)
                }),
            })
        }
    }
}

// Build the merged `$scope` an emitted mount reads (mirrors the SSR scope in server/internal/pages.ts):
// the RPC + socket proxies (keyed by the local import name), the seed's recorded reads/streams replayed
// into those memos BEFORE mount (so a seeded read never re-fetches), plus the framework bindings —
// `state` (the seed-replaying wrapper; its ordinal resets per call and consumes `seed.states` in order),
// `watch`, `props()`, and the isomorphic `route`/`url`/`navigate`. Reused for both the whole-page mount
// and a same-chain soft-nav's diverging-suffix sub-hydrate (C6.2), each with its own (partial) seed.
export function buildPageScope(
    seed: HydrationSeed,
    rpcSpecs: RpcSpecs,
    base?: string,
    socketSpecs?: SocketSpecs,
): Record<string, unknown> {
    const imports = {
        ...makeClientImports(rpcSpecs, base),
        ...makeClientSocketImports(socketSpecs ?? {}, base),
    }
    replayReads(seed, imports)
    replayStreams(seed, imports, base ?? '')
    // CO2.3: adopt the rendering request's traceparent onto the tab scope, so a browser `trace()` (and
    // every log line, which auto-correlates on it) names the server span that produced this page. Runs
    // on first load AND on a full soft-nav's sub-hydrate, each carrying its own request's id.
    adoptTrace(seed.trace)
    // Strip ALL internal seed sections — `reads`, `states`, `streams`, and `trace` are hydration
    // plumbing, not page props. Leaving `states`/`streams` in would make client `props()` return an
    // encoded blob / handoff records while the server's `props()` returns `{}` — an isomorphism break
    // + internal leak.
    const { reads: _reads, states: _states, streams: _streams, trace: _trace, ...props } = seed
    imports.route = route
    imports.url = url
    imports.navigate = navigate
    return { ...imports, state: makeSeededState(seed, isHydrating), watch, props: () => props }
}

// Bootstrap a page in the browser from its AOT-emitted client `hydrate`. Returns a cleanup function
// that disposes the mount (unmounts effects). A no-op outside the browser (no `document`), so
// importing the entry under SSR is safe. `hydrate` claims the server DOM; on an unrecoverable root
// mismatch it fresh-mounts internally.
export function bootstrapPage(
    hydrate: PageMount,
    rpcSpecs: RpcSpecs,
    base?: string,
    seedOverride?: HydrationSeed,
    socketSpecs?: SocketSpecs,
): () => void {
    if (typeof document === 'undefined') return () => {}

    const container = document.getElementById(CONTAINER_ID)
    if (container === null) return () => {}

    // First load reads the inline seed script; a soft-nav passes its envelope seed as `seedOverride`
    // (the inline script is stale after the initial document).
    const seed = seedOverride ?? readSeed()
    const scope = buildPageScope(seed, rpcSpecs, base, socketSpecs)

    // Attach-hydration (Stage 2, PR7): CLAIM the SSR DOM in place — no container clear. The emitted
    // `hydrate` seeds its cursor from the server DOM, claims each node (suppressing the initial write —
    // the server already rendered the seeded value), and whole-page-falls-back to a fresh mount if the
    // root structure is unrecoverable. A streamed `{#for await}` re-reads its memo (warmed above by
    // `replayStreams`) — no separate DOM handoff.
    return hydrate(container, scope)
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
    socketSpecs?: SocketSpecs,
): () => void {
    if (typeof document === 'undefined') return () => {}
    registerPages(loaders, rpcSpecs, base, socketSpecs)
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
