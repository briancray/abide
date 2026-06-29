import { appNameSlot } from '../../shared/appNameSlot.ts'
import { SSR_CACHE_CONTROL } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { formatTraceparent } from '../../shared/formatTraceparent.ts'
import { layoutChainForRoute } from '../../shared/layoutChainForRoute.ts'
import { safeJsonForScript } from '../../shared/safeJsonForScript.ts'
import { snapshotShippable } from '../../shared/snapshotShippable.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
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

A page with no `await` block renders synchronously and ships buffered. A page with
await blocks STREAMS: the pending shell flushes first, then each resolved fragment
(`<abide-resolve>` carrying a JSON `<script>`) as its promise settles, swapped into its boundary
by the inline SSR_SWAP_SCRIPT — which also registers the value into the resume
manifest so client hydration adopts it without re-fetching (see abide/ui/awaitBlock).
Then, once the stream has run every `{#await}` thunk (creating and settling its cache
entry mid-stream, after the render-return snapshot), each such entry streams an inline
`__abideResolve(...)` chunk — a warm snapshot, or a `{ key, miss }` marker for an
unshippable body (→ live refetch) — seeding the client store before the deferred bundle
so the block's subscription read is warm (no refetch).

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
            base: base || undefined,
            trace: formatTraceparent(store.trace),
            app: appNameSlot.name,
            health,
            clientTimeout,
        })
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
        return links === '' ? html : html.replace(/<\/head>/i, `${links}</head>`)
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
        const chainKeys = layoutChainForRoute(routeUrl, Object.keys(layouts))
        const views = await Promise.all([
            ...chainKeys.map((key) => layouts[key]?.().then((module) => module.default)),
            loadPage().then((module) => module.default),
        ])
        const ssr = await renderChain(
            views.filter((view): view is UiComponent => view !== undefined),
            params,
        )

        /* Snapshot the cache settled by render-return — top-level `await` reads and blocking
           `{#await … then}` reads (the async render awaited them inline) — into __SSR__. A
           STREAMING `{#await}` read is NOT here: its expression is a thunk `renderToStream`
           runs lazily, so its entry is created mid-stream and seeded after the drain (below). */
        const inline = await serializeCacheSnapshot(store.cache)
        const inlinedKeys = new Set(inline.map((entry) => entry.key))

        /* No STREAMING await blocks → ship buffered. Blocking `{#await … then}` blocks
           rendered inline (their markup is already in `ssr.html`); seed their resolved
           values so hydration adopts them without a refetch. */
        if (ssr.awaits.length === 0) {
            const html = injectRoutePreloads(
                shell.replace(SSR_MARKER, (_match, key: string) =>
                    key === 'body' ? ssr.html : key === 'state' ? '' : '',
                ),
                routeUrl,
            )
            const withState = html.replace(
                '</body>',
                `${resumeSeedScript(ssr.resume)}${await stateTag(routeUrl, params, store, inline)}</body>`,
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
            shell.replace(/<!--ssr:(head|state)-->/g, (_match, key: string) =>
                key === 'head' ? head : '',
            ),
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
                        /* The {#await} reads created (and settled) their cache entries DURING the
                           stream — the await expression is a thunk `renderToStream` ran lazily —
                           so they missed the render-return snapshot. Drain them now: each lands an
                           inline `__abideResolve(...)` chunk (a warm snapshot, or a `{ key, miss }`
                           marker for an unshippable body → live refetch) before the deferred
                           bundle, so startClient seeds the store and the block's subscription read
                           is warm. Skip keys already shipped inline in __SSR__. */
                        const streamedEntries = Array.from(store.cache.entries.values()).filter(
                            (entry) => snapshotShippable(entry) && !inlinedKeys.has(entry.key),
                        )
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
