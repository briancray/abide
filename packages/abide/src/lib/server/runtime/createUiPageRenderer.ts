import { appNameSlot } from '../../shared/appNameSlot.ts'
import { SSR_CACHE_CONTROL } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { formatTraceparent } from '../../shared/formatTraceparent.ts'
import { layoutChainForRoute } from '../../shared/layoutChainForRoute.ts'
import { renderChain } from '../../ui/renderChain.ts'
import { renderToStream } from '../../ui/renderToStream.ts'
import type { UiComponent } from '../../ui/runtime/types/UiComponent.ts'
import { pageUrlFromStore } from './pageUrlFromStore.ts'
import { SSR_SWAP_SCRIPT } from './SSR_SWAP_SCRIPT.ts'
import { safeJsonForScript } from './safeJsonForScript.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import type { RequestStore } from './types/RequestStore.ts'

/* A abide-ui page module: its default export is the compiled component. */
type LoadPage = () => Promise<{ default: UiComponent }>

const SSR_MARKER = /<!--ssr:(head|body|state)-->/g
const BODY_MARKER = '<!--ssr:body-->'

function wantsJson(request: Request): boolean {
    return (request.headers.get('accept') ?? '').includes('application/json')
}

/*
The abide-ui SSR document renderer. A matched route + params in, a finished HTML
Response out.

A page with no `await` block renders synchronously and ships buffered. A page with
await blocks STREAMS: the pending shell flushes first, then each resolved fragment
(`<abide-resolve>` carrying a JSON `<script>`) as its promise settles, swapped into its boundary
by the inline SSR_SWAP_SCRIPT — which also registers the value into the resume
manifest so client hydration adopts it without re-fetching (see abide/ui/awaitBlock).

`__SSR__` carries the route/params, mount base, trace, app name, client timeout,
and the settled cache snapshot (the client seeds its tab store from it). A route's
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
    healthPayload,
}: {
    shell: string
    base: string
    clientTimeout: number | undefined
    pages: Record<string, LoadPage>
    layouts: Record<string, LoadPage>
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
    /* Build the __SSR__ <script> the client (startClient) reads on boot. */
    async function stateTag(
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ): Promise<string> {
        const { inline } = await serializeCacheSnapshot(store.cache)
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
        const ssr = renderChain(
            views.filter((view): view is UiComponent => view !== undefined),
            params,
        )

        /* No await blocks → render synchronously, ship buffered. */
        if (ssr.awaits.length === 0) {
            const html = shell.replace(SSR_MARKER, (_match, key: string) =>
                key === 'body' ? ssr.html : key === 'state' ? '' : '',
            )
            const withState = html.replace(
                '</body>',
                `${await stateTag(routeUrl, params, store)}</body>`,
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
        const head = `<script>${SSR_SWAP_SCRIPT}</script>${await stateTag(routeUrl, params, store)}`
        const filled = shell.replace(/<!--ssr:(head|state)-->/g, (_match, key: string) =>
            key === 'head' ? head : '',
        )
        const [before, after] = filled.split(BODY_MARKER)
        const encoder = new TextEncoder()
        return new Response(
            new ReadableStream({
                async start(controller) {
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
                    controller.enqueue(encoder.encode(after ?? ''))
                    controller.close()
                },
            }),
            {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': SSR_CACHE_CONTROL,
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
