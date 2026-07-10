import { appNameSlot } from '../../shared/appNameSlot.ts'
import { SSR_CACHE_CONTROL } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { encodeRefJson } from '../../shared/encodeRefJson.ts'
import { formatTraceparent } from '../../shared/formatTraceparent.ts'
import { hasReplayableRequest } from '../../shared/hasReplayableRequest.ts'
import { layoutChainForRoute } from '../../shared/layoutChainForRoute.ts'
import { resolvedCellsSlot } from '../../shared/resolvedCellsSlot.ts'
import { safeJsonForScript } from '../../shared/safeJsonForScript.ts'
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
            try {
                cells[key] = encodeRefJson(value)
            } catch {
                console.warn(
                    `[abide] async cell "${key}" resolved to an unserializable value — it will re-run on the client instead of hydrating warm.`,
                )
            }
        }
        return Object.keys(cells).length > 0 ? cells : undefined
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
        const views = await Promise.all([
            ...chainKeys.map((key) => layouts[key]?.().then((module) => module.default)),
            loadPage().then((module) => module.default),
        ])
        /* Route keys aligned 1:1 with `views` (layouts then page) — byte-identical to the client
           router's `chainKeys`/`pageKey`, so a cell's render-path scope id matches across the
           boundary for the warm-seed key. No layout view is ever dropped by the filter (every
           `chainKeys[i]` resolves a real layout), so the keys stay index-aligned with it. */
        const chainViewKeys = [...chainKeys, routeUrl]
        const ssr = await renderChain(
            views.filter((view): view is UiComponent => view !== undefined),
            params,
            chainViewKeys,
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
           instead of shipping `undefined` buffered. `hasReplayableRequest` (the request half of
           shippability — not `snapshotShippable`, which also demands `settled`) is the gate: it
           excludes producers, writes, and stream cells (a `NamedAsyncIterable` cell holds no
           wire request), which must stay `peek()`-at-flush and buffered. `!inlinedKeys` drops
           anything already baked into `__SSR__` (a Tier-2 top-level `await`) so a value never
           double-ships. */
        const pendingBareReads = Array.from(store.cache.entries.values()).filter(
            (entry) => hasReplayableRequest(entry) && !inlinedKeys.has(entry.key),
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
                            (entry) => hasReplayableRequest(entry) && !inlinedKeys.has(entry.key),
                        )
                        /* `hasReplayableRequest`, NOT `snapshotShippable`: a triggered bare read
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
