import { appNameSlot } from '../../shared/appNameSlot.ts'
import { SSR_CACHE_CONTROL } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { docSnapshotsSlot } from '../../shared/docSnapshotsSlot.ts'
import { encodeSeedValue } from '../../shared/encodeSeedValue.ts'
import { formatTraceparent } from '../../shared/formatTraceparent.ts'
import { hasSeedableRequest } from '../../shared/hasSeedableRequest.ts'
import { layoutChainForRoute } from '../../shared/layoutChainForRoute.ts'
import { resolvedCellsSlot } from '../../shared/resolvedCellsSlot.ts'
import { safeJsonForScript } from '../../shared/safeJsonForScript.ts'
import { socketTailsSlot } from '../../shared/socketTailsSlot.ts'
import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
import type { SsrPayload } from '../../shared/types/SsrPayload.ts'
import type { StreamedResolution } from '../../shared/types/StreamedResolution.ts'
import { renderChain } from '../../ui/renderChain.ts'
import { renderToStream } from '../../ui/renderToStream.ts'
import { resumeSeedScript } from '../../ui/resumeSeedScript.ts'
import type { UiComponent } from '../../ui/runtime/types/UiComponent.ts'
import { pageUrlFromStore } from './pageUrlFromStore.ts'
import { SSR_SWAP_SCRIPT } from './SSR_SWAP_SCRIPT.ts'
import { STREAMED_HTML_HEADER } from './STREAMED_HTML_HEADER.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import { streamCacheResolutions } from './streamCacheResolutions.ts'
import type { RequestStore } from './types/RequestStore.ts'

/* A abide-ui page module: its default export is the compiled component. */
type LoadPage = () => Promise<{ default: UiComponent }>

const SSR_MARKER = /<!--ssr:(head|body|state)-->/g
const BODY_MARKER = '<!--ssr:body-->'
/* Compiled once — both fill the shell per page render. */
const HEAD_STATE_MARKER = /<!--ssr:(head|state)-->/g
const HEAD_CLOSE_TAG = /<\/head>/i

function wantsJson(request: Request): boolean {
    return (request.headers.get('accept') ?? '').includes('application/json')
}

/* Defines `window.__abideResolve` ahead of the body: the vanilla collector each
   streamed cache resolution calls, buffering payloads for startClient to drain into
   the store before hydration (the bundle is deferred, so it runs after every chunk). */
const CACHE_RESOLVE_SCRIPT =
    'window.__abideResolve=function(r){(window.__abideResumeCache=window.__abideResumeCache||[]).push(r)}'

/* One streamed cache resolution as an inline `__abideResolve(...)` call. Encoded via
   safeJsonForScript so `<`, `-->`, and U+2028/U+2029 can't close the script early or
   parse as line terminators — the same escaping the page's other inline scripts use. */
function resolveChunk(resolution: StreamedResolution): string {
    return `<script>__abideResolve(${safeJsonForScript(resolution)})</script>`
}

/*
The abide-ui SSR document renderer. A matched route + params in, a finished HTML
Response out.

A page with no `await` block AND no pending triggered bare read renders synchronously and
ships buffered. A page with await blocks — or a triggered BARE async read still pending at
render-return (ADR-0024) — STREAMS: the pending shell flushes first, then each resolved
fragment (`<abide-resolve>` carrying a JSON `<script>`) as its promise settles, swapped into
its boundary by the inline SSR_SWAP_SCRIPT — which also registers the value into the resume
manifest so client hydration adopts it without re-fetching (see abide/ui/awaitBlock).
Then, once the stream has run every `{#await}` thunk (creating and settling its cache
entry mid-stream, after the render-return snapshot), each such entry — plus any bare-read
entry triggered during the sync render — streams an inline `__abideResolve(...)` chunk: a
warm snapshot, or a `{ key, miss }` marker for an unshippable body — e.g. a read 504'd by its
endpoint `timeout` (→ live refetch) — seeding the client store before the deferred bundle
so the block's / bare read's subscription is warm (no refetch).

`__SSR__` carries the route/params, mount base, trace, app name, client timeout,
and the render-return cache snapshot (top-level `await` reads; the client seeds its tab
store from it). `{#await}` reads aren't settled yet at render-return — they arrive over
the stream as above. A route's
`layout.abide` files wrap the page outermost-first (every ancestor directory's
layout applies); the chain server-renders as one document via `renderChain`, the
page folded into each layout's `<slot/>` outlet. The client router re-resolves the
same chain and keeps shared layouts mounted across navigation.
*/
export function createUiPageRenderer({
    shell,
    base,
    clientTimeout,
    pages,
    layouts,
    routePreloads = {},
    healthPayload,
}: {
    shell: string
    base: string
    clientTimeout: number | undefined
    pages: Record<string, LoadPage>
    layouts: Record<string, LoadPage>
    routePreloads?: Record<string, string[]>
    healthPayload: (request: Request) => Promise<Record<string, unknown>>
}): {
    renderPage: (
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ) => Promise<Response>
    renderError: (
        status: number,
        message: string,
        store: RequestStore,
        stack?: string,
    ) => Promise<Response | undefined>
} {
    /* The `cells` partition of __SSR__: every async cell that RESOLVED during this render (drained
       from the request-scoped `resolvedCellsSlot` populated by `createAsyncCell.settleValue`),
       keyed by its render-path id, each value ref-json-encoded so an in-process graph survives.
       An unserializable value is dropped (a warn) — that one cell falls back to a client re-run
       rather than blanking the payload. Undefined when no cell resolved (the common static page). */
    function resolvedCellCells(): Record<string, string> | undefined {
        const entries = resolvedCellsSlot.get()?.entries ?? []
        if (entries.length === 0) {
            return undefined
        }
        const cells: Record<string, string> = {}
        for (const { key, value } of entries) {
            const encoded = encodeSeedValue(
                value,
                `async cell "${key}" resolved value`,
                'it will re-run on the client instead of hydrating warm',
            )
            if (encoded !== undefined) {
                cells[key] = encoded
            }
        }
        return Object.keys(cells).length > 0 ? cells : undefined
    }

    /* The `docs` partition of __SSR__: each rendered scope's reactive-document snapshot (drained from
       the request-scoped `docSnapshotsSlot` populated by `createScope`), keyed by its render-path id,
       ref-json-encoded. A scope that used no state snapshots to `{}` and is dropped; an unserializable
       doc value is dropped with the cell falling back to a client re-init. Undefined when no scope
       carried seedable synchronous state (the common cell-only or static page). */
    function docSeedSnapshots(): Record<string, string> | undefined {
        const entries = docSnapshotsSlot.get()?.entries ?? []
        if (entries.length === 0) {
            return undefined
        }
        const docs: Record<string, string> = {}
        for (const { id, take } of entries) {
            let snapshot: unknown
            try {
                snapshot = take()
            } catch {
                continue
            }
            if (
                snapshot === null ||
                typeof snapshot !== 'object' ||
                Object.keys(snapshot).length === 0
            ) {
                continue
            }
            const encoded = encodeSeedValue(
                snapshot,
                `scope "${id}" state snapshot`,
                'the client re-inits its state cold',
            )
            if (encoded !== undefined) {
                docs[id] = encoded
            }
        }
        return Object.keys(docs).length > 0 ? docs : undefined
    }

    /* The `sockets` partition of __SSR__: each socket whose retained frame this render read via
       `peek(socket)` (drained from the request-scoped `socketTailsSlot` populated by
       `defineSocket.peek`), keyed by socket NAME, ref-json-encoded. Last write per name wins — a
       socket peeked twice ships its latest read. An unserializable frame is dropped (a warn): that
       socket falls back to a cold client peek (undefined) rather than blanking the payload. Undefined
       when no socket was peeked during the render (the common page). */
    function socketTailSnapshots(): Record<string, string> | undefined {
        const entries = socketTailsSlot.get()?.entries ?? []
        if (entries.length === 0) {
            return undefined
        }
        const sockets: Record<string, string> = {}
        for (const { name, value } of entries) {
            const encoded = encodeSeedValue(
                value,
                `socket "${name}" retained frame`,
                'its client peek() reads undefined at hydration instead of the server value',
            )
            if (encoded !== undefined) {
                sockets[name] = encoded
            }
        }
        return Object.keys(sockets).length > 0 ? sockets : undefined
    }

    /* Build the __SSR__ <script> the client (startClient) reads on boot. The inline
       (settled) cache partition is computed once by the caller and threaded in, so the
       streaming branch can also drain the pending partition over the same render. */
    async function stateTag(
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
        inline: CacheSnapshotEntry[],
    ): Promise<string> {
        const health = store.healthRead ? await healthPayload(store.req) : undefined
        const payload = safeJsonForScript({
            route: routeUrl,
            params,
            cache: inline,
            cells: resolvedCellCells(),
            docs: docSeedSnapshots(),
            sockets: socketTailSnapshots(),
            base: base || undefined,
            trace: formatTraceparent(store.trace),
            app: appNameSlot.name,
            health,
            clientTimeout,
        } satisfies SsrPayload)
        return `<script>window.__SSR__ = ${payload};</script>`
    }

    /* Per-route `<link rel=modulepreload>`s for the route's page + layout-chain chunks
       and their route-only static runtime deps (the shell already preloads the entry's
       shared runtime). Those chunks are dynamically imported by the entry, so the browser
       discovers them only after the entry runs at parse-end ≈ stream-close; preloading them
       in <head> overlaps their transfer with the stream. Rebased onto the mount base like
       the shell's own `/_app/` refs. Cached per route — the set is render-invariant. */
    const preloadLinkCache = new Map<string, string>()
    function routePreloadLinks(routeUrl: string): string {
        const cached = preloadLinkCache.get(routeUrl)
        if (cached !== undefined) {
            return cached
        }
        const links = (routePreloads[routeUrl] ?? [])
            .map((chunk) => `<link rel="modulepreload" href="${base}/_app/${chunk}" />`)
            .join('')
        preloadLinkCache.set(routeUrl, links)
        return links
    }

    /* Splices the route preloads in before the shell's </head> (case-insensitive, like the
       build-time injector). A no-op when there are none or the shell carries no </head>. */
    function injectRoutePreloads(html: string, routeUrl: string): string {
        const links = routePreloadLinks(routeUrl)
        return links === '' ? html : html.replace(HEAD_CLOSE_TAG, () => `${links}</head>`)
    }

    /* The layout chain for a route is a pure function of routeUrl and the fixed `layouts`
       map, so memoise it per route (like `preloadLinkCache`) instead of re-scanning and
       re-sorting every layout key on every request. */
    const layoutKeys = Object.keys(layouts)
    const chainKeyCache = new Map<string, string[]>()
    function chainKeysForRoute(routeUrl: string): string[] {
        const cached = chainKeyCache.get(routeUrl)
        if (cached !== undefined) {
            return cached
        }
        const chain = layoutChainForRoute(routeUrl, layoutKeys)
        chainKeyCache.set(routeUrl, chain)
        return chain
    }

    async function renderPage(
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ): Promise<Response> {
        store.route = routeUrl
        store.params = params
        /* Touch pageUrl so the page proxy resolves the browser-space URL during SSR. */
        pageUrlFromStore(store)
        if (wantsJson(store.req)) {
            return Response.json(
                { route: routeUrl, params },
                { headers: { Vary: 'Accept', 'Cache-Control': SSR_CACHE_CONTROL } },
            )
        }
        const loadPage = pages[routeUrl]
        if (loadPage === undefined) {
            throw new Error(`[abide] unknown route: ${routeUrl}`)
        }
        /* Outermost layout → … → page: load every applicable layout chunk plus the
           page, then render the chain as one document (shared block-id pass). */
        const chainKeys = chainKeysForRoute(routeUrl)
        /* Resolve each view PAIRED with its render-path key (layouts then page), then filter the
           pairs together. Zipping in one pass makes the key↔view alignment structural rather than
           an asserted "no view is ever dropped" invariant: were a layout to resolve to no default
           export, dropping it would otherwise shift every later key by one and mis-key the page's
           cells (a silent warm-seed mismatch — the class this render-path id exists to kill). The
           keys stay byte-identical to the client router's `chainKeys`/`pageKey`. */
        const resolved = await Promise.all([
            ...chainKeys.map((key) =>
                layouts[key]?.().then((module) => ({ key, view: module.default })),
            ),
            loadPage().then((module) => ({ key: routeUrl, view: module.default })),
        ])
        const kept = resolved.filter(
            (entry): entry is { key: string; view: UiComponent } =>
                entry !== undefined && entry.view !== undefined,
        )
        const ssr = await renderChain(
            kept.map((entry) => entry.view),
            params,
            kept.map((entry) => entry.key),
        )

        /* Snapshot the cache settled by render-return — top-level `await` reads and blocking
           `{#await … then}` reads (the async render awaited them inline) — into __SSR__. A
           STREAMING `{#await}` read is NOT here: its expression is a thunk `renderToStream`
           runs lazily, so its entry is created mid-stream and seeded after the drain (below). */
        const inline = await serializeCacheSnapshot(store.cache)
        const inlinedKeys = new Set(inline.map((entry) => entry.key))

        /* ADR-0024: a bare async read (`{user}`, no `{#await}`) that TRIGGERED its fetch during
           the sync render leaves a still-pending replayable entry in the store at render-return
           — not yet settled, so it missed the inline snapshot above. Detecting one here is what
           opens the streaming gate for a page with no await block, so its value streams in
           instead of shipping `undefined` buffered. `hasSeedableRequest` (the request half of
           shippability — not `snapshotShippable`, which also demands `settled`) is the gate: it
           excludes producers and stream cells (a `NamedAsyncIterable` cell holds no wire
           request), which must stay `peek()`-at-flush and buffered. `!inlinedKeys` drops
           anything already baked into `__SSR__` (a Tier-2 top-level `await`) so a value never
           double-ships. */
        const pendingBareReads = Array.from(store.cache.entries.values()).filter(
            (entry) => hasSeedableRequest(entry) && !inlinedKeys.has(entry.key),
        )

        /* No STREAMING await blocks AND no triggered bare read pending → ship buffered exactly
           as before. Blocking `{#await … then}` blocks rendered inline (their markup is already
           in `ssr.html`); seed their resolved values so hydration adopts them without a refetch. */
        if (ssr.awaits.length === 0 && pendingBareReads.length === 0) {
            const html = injectRoutePreloads(
                shell.replace(SSR_MARKER, (_match, key: string) =>
                    key === 'body' ? ssr.html : key === 'state' ? '' : '',
                ),
                routeUrl,
            )
            /* Function replacer: the state script carries user cache data, and a string
               replacement would interpret `$&`/`$'`-style patterns inside it. */
            const state = await stateTag(routeUrl, params, store, inline)
            const withState = html.replace(
                '</body>',
                () => `${resumeSeedScript(ssr.resume)}${state}</body>`,
            )
            return new Response(withState, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    Vary: 'Accept',
                    'Cache-Control': SSR_CACHE_CONTROL,
                },
            })
        }

        /* Await blocks → stream the shell, then resolved fragments as they settle.
           Fill head/state but LEAVE the body marker intact — it's the split point for
           streaming the page body into `#app`; consuming it here would append the body
           after the whole shell (outside `#app`), breaking hydration. */
        const head =
            `<script>${SSR_SWAP_SCRIPT}${CACHE_RESOLVE_SCRIPT}</script>` +
            `${await stateTag(routeUrl, params, store, inline)}`
        /* ADR-0039: the async-cell keys already baked into the head `__SSR__.cells` snapshot. A
           streamed child's render is deferred to the drain, so its BLOCKING cells resolve AFTER this
           and must ship as post-body `{cellSeed}` chunks instead — the delta below is keys NOT here.
           Read `store` directly (the stream body runs outside the request ALS). */
        const seededCellKeys = new Set(store.resolvedCells.entries.map((entry) => entry.key))
        const filled = injectRoutePreloads(
            shell.replace(HEAD_STATE_MARKER, (_match, key: string) => (key === 'head' ? head : '')),
            routeUrl,
        )
        const [before, after] = filled.split(BODY_MARKER)
        const encoder = new TextEncoder()
        return new Response(
            new ReadableStream({
                async start(controller) {
                    /* The shell `before` already flushed, so a mid-stream render rejection
                       (a streaming `{#await}` with no `:catch`) can't become a 500 — surface it
                       on the stream (`controller.error`) so the response terminates legibly
                       instead of leaking an unhandledrejection (process-fatal under Bun). */
                    try {
                        controller.enqueue(encoder.encode(before ?? ''))
                        let first = true
                        for await (const chunk of renderToStream(() => ssr)) {
                            controller.enqueue(
                                encoder.encode(
                                    first ? chunk : `${chunk}<script>__abideSwap()</script>`,
                                ),
                            )
                            first = false
                        }
                        /* Two kinds of pending entry land here. (1) `{#await}` reads created (and
                           settled) their cache entries DURING the stream — the await expression is a
                           thunk `renderToStream` ran lazily — so they missed the render-return
                           snapshot. (2) A triggered BARE read (ADR-0024) created its entry during the
                           sync render but was never awaited, so it may still be in flight now. Drain
                           both: each lands an inline `__abideResolve(...)` chunk (a warm snapshot, or a
                           `{ key, miss }` marker for an unshippable body — e.g. a read 504'd by its
                           endpoint timeout → live refetch) before the deferred bundle, so startClient seeds
                           the store and the read's subscription is warm. Skip keys already shipped inline in
                           __SSR__. */
                        const streamedEntries: CacheEntry[] = Array.from(
                            store.cache.entries.values(),
                        ).filter(
                            (entry) => hasSeedableRequest(entry) && !inlinedKeys.has(entry.key),
                        )
                        /* `hasSeedableRequest`, NOT `snapshotShippable`: a triggered bare read
                           (ADR-0024) is drained here still-pending (never awaited by an `{#await}`
                           thunk), so gating on `settled` up front would skip it — streamCacheResolutions
                           awaits each entry's body itself (see snapshotEntryFromCache). A pending read is
                           bounded by its OWN endpoint `timeout` (which 504s the in-process handler during
                           SSR), so there is no separate SSR-stream deadline. A late-settling `{#await}`
                           entry is already settled by now, so the set is unchanged for the Tier-3 path. */
                        for await (const resolution of streamCacheResolutions(
                            store.cache,
                            streamedEntries,
                        )) {
                            controller.enqueue(encoder.encode(resolveChunk(resolution)))
                        }
                        /* ADR-0035: stream each STREAMING cell that SETTLED during this render as an
                           `__abideResolve({ cellKey, value })` chunk (keyed by its render-path id),
                           so the client adopts it post-hydration instead of only cold-re-running the
                           seed — the flash the pre-mount `__SSR__.cells` warm-seed can't fix without
                           diverging from the pending shell. These are already-settled VALUES
                           (recorded in createAsyncCell.settleValue), never awaited here: a cell that
                           stays pending through the request (`{#if getFoo()}` holds) is simply not
                           streamed and the client cold-runs it. An unserializable value emits nothing.
                           Read from `store` directly since the stream body runs outside the request ALS. */
                        for (const { key, value } of store.streamedCells.entries) {
                            const encoded = encodeSeedValue(
                                value,
                                `streaming cell "${key}" settled value`,
                                'the client cold-runs its seed instead of adopting the streamed value',
                            )
                            if (encoded === undefined) {
                                continue
                            }
                            controller.enqueue(
                                encoder.encode(resolveChunk({ cellKey: key, value: encoded })),
                            )
                        }
                        /* ADR-0039: a STREAMED CHILD's BLOCKING async cells resolved during this drain,
                           after the head `__SSR__.cells` snapshot — ship the delta (keys not already
                           seeded) as `{cellSeed}` chunks so startClient seeds CELL_SEED before the
                           child's deferred mount and its cell constructs resolved (no flash/re-run). */
                        for (const { key, value } of store.resolvedCells.entries) {
                            if (seededCellKeys.has(key)) {
                                continue
                            }
                            const encoded = encodeSeedValue(
                                value,
                                `streamed child's async cell "${key}" resolved value`,
                                'it will re-run on the client instead of hydrating warm',
                            )
                            if (encoded === undefined) {
                                continue
                            }
                            controller.enqueue(
                                encoder.encode(resolveChunk({ cellSeed: key, value: encoded })),
                            )
                        }
                        controller.enqueue(encoder.encode(after ?? ''))
                        controller.close()
                    } catch (streamError) {
                        controller.error(streamError)
                    }
                },
            }),
            {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': SSR_CACHE_CONTROL,
                    /* Mark the progressively-flushed document so gzipResponse compresses it
                       with a per-chunk-flushing gzip (the plain CompressionStream buffers the
                       head and defeats streaming); the marker is stripped before send. */
                    [STREAMED_HTML_HEADER]: '1',
                },
            },
        )
    }

    /* Error pages are not framework-resolved in abide-ui — no error view to render,
       so the caller falls back to its plain Response (404 text) or rethrows. */
    async function renderError(): Promise<Response | undefined> {
        return undefined
    }

    return { renderPage, renderError }
}
