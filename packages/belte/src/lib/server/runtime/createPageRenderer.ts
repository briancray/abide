import { render } from 'svelte/server'
import App from '../../../App.svelte'
import { appNameSlot } from '../../shared/appNameSlot.ts'
import { belteLog } from '../../shared/belteLog.ts'
import { NO_STORE, SSR_CACHE_CONTROL } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { errorParamsForThrow } from '../../shared/errorParamsForThrow.ts'
import { formatTraceparent } from '../../shared/formatTraceparent.ts'
import type { ViewResolver } from '../../shared/types/ViewResolver.ts'
import { pageUrlFromStore } from './pageUrlFromStore.ts'
import { safeJsonForScript } from './safeJsonForScript.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import { stashPendingStream } from './streamStash.ts'
import type { RequestStore } from './types/RequestStore.ts'

function wantsJson(req: Request): boolean {
    return (req.headers.get('accept') ?? '').includes('application/json')
}

// SSR placeholders the shell carries; filled in a single pass per render.
const SSR_MARKER = /<!--ssr:(head|body|state)-->/g

/*
The SSR document renderer: route + params in, a finished HTML (or JSON view)
Response out. Owns everything between a matched route and the bytes on the
wire — view resolution via the injected resolver, the svelte render, the
inline-vs-streaming partition of the request's cache reads, the `__SSR__`
state tag, and splicing it all into the shell's markers. createServer wires
it once; the route dispatcher and the 404 path are its only callers.
*/
export function createPageRenderer({
    shell,
    base,
    viewResolver,
    healthPayload,
}: {
    shell: string
    /* APP_URL mount base ('' at root). Shipped in __SSR__ so the client installs the same base resolver. */
    base: string
    viewResolver: ViewResolver
    /* Builds the /__belte/health payload for a render that read health() — the client's __SSR__ seed. */
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
    /* Splices the rendered head/body and a state <script> into the shell's SSR markers. */
    function fillShell(rendered: Awaited<ReturnType<typeof render>>, stateTag: string): string {
        const fills: Record<string, string> = {
            head: rendered.head,
            body: rendered.body,
            state: stateTag,
        }
        // The marker keys are exactly the fills' keys; '' satisfies noUncheckedIndexedAccess in consumer tsconfigs.
        return shell.replace(SSR_MARKER, (_match, key: string) => fills[key] ?? '')
    }

    /*
    Renders the nearest error.svelte for a failed page navigation — an unknown
    route (404) or a throw during a page render. The resolver picks the deepest
    error.svelte ancestor (nearest-only, like layouts) and the pathname-nearest
    layout; renders with `{ status, message, stack }` props. Returns undefined
    when no error.svelte covers the path, so the caller falls back to its plain
    Response (the 404 text) or rethrows (→ app.handleError). The document is
    static — it ships `__SSR__.error` so the client skips hydration (there is
    no client route for an error view to hydrate against).

    The full message and stack are passed through; nothing is serialized to
    `__SSR__`, so they reach the browser only where the author's template
    actually renders them — a bare error.svelte leaks neither. Withholding them
    would just deny an author who wants a dev stack, so exposure stays the
    author's call (and the cause is logged server-side regardless).
    */
    async function renderError(
        status: number,
        message: string,
        store: RequestStore,
        stack?: string,
    ): Promise<Response | undefined> {
        const pathname = store.url.pathname
        const resolved = await viewResolver.error(pathname)
        if (!resolved) {
            return undefined
        }
        const { Page: ErrorView, Layout } = resolved
        // status is a number (and stack optional); the page-params shape is
        // string-keyed generically, so the error props ride through as-is.
        const errorParams = { status, message, stack } as unknown as Record<string, string>
        /* Publish to the store too, so the `page` proxy resolves these during the error render
           (renderError bypasses renderPage, which is where normal renders set them). */
        store.route = pathname
        store.params = errorParams
        const rendered = await render(App, {
            props: {
                state: {
                    page: { route: pathname, params: errorParams, url: pageUrlFromStore(store) },
                    render: { Layout, Page: ErrorView },
                },
            },
        })
        const stateTag = `<script>window.__SSR__ = ${safeJsonForScript({ error: true })};</script>`
        const html = fillShell(rendered, stateTag)
        return new Response(html, {
            status,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': NO_STORE,
            },
        })
    }

    async function renderPage(
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ): Promise<Response> {
        /* Publish the match so the `page` proxy resolves route/params during SSR render. */
        store.route = routeUrl
        store.params = params
        const json = wantsJson(store.req)
        if (json) {
            return Response.json(
                { route: routeUrl, params },
                {
                    headers: {
                        Vary: 'Accept',
                        'Cache-Control': SSR_CACHE_CONTROL,
                    },
                },
            )
        }
        try {
            return await renderPageHtml(routeUrl, params, store)
        } catch (error) {
            /*
            A page render failed (module import, component throw, or a settled
            cache read). error.svelte wins for page renders: render the nearest
            one with a 500, logging the cause it's about to swallow into a
            presentable page. With no error.svelte covering the path, rethrow so
            app.handleError — or the framework 500 — takes it.
            */
            const { status, message, stack } = errorParamsForThrow(error)
            const rendered = await renderError(status, message, store, stack)
            if (rendered) {
                belteLog.error(error)
                return rendered
            }
            throw error
        }
    }

    async function renderPageHtml(
        routeUrl: string,
        params: Record<string, string>,
        store: RequestStore,
    ): Promise<Response> {
        const { Page, Layout } = await viewResolver.view(routeUrl)
        const rendered = await render(App, {
            props: {
                state: {
                    page: {
                        route: routeUrl,
                        params,
                        url: pageUrlFromStore(store),
                    },
                    render: { Layout, Page },
                },
            },
        })
        /*
        Settled entries (awaited reads render() blocked on) inline into the
        first chunk; pending entries ({#await} reads) stream a resolve script
        each as their fetch lands. A page with no pending reads stays a plain
        buffered Response — no streaming overhead when nothing's deferred.
        */
        const { inline, pending } = await serializeCacheSnapshot(store.cache)
        /*
        Settled reads inline into `__SSR__`. Pending {#await} reads ship their
        keys in `__SSR__.streaming` (so the client pre-creates placeholders that
        cache() hits instead of re-fetching) plus a single-use `streamToken`; the
        in-flight promises are stashed under that token for the out-of-band
        resolve endpoint to drain. The document itself is a plain buffered
        response — it closes immediately, so hydration isn't gated on the stream.
        */
        const streaming = pending.map((entry) => ({
            key: entry.key,
            /* serializeCacheSnapshot only ever yields request-bearing (remote) entries here. */
            url: entry.request?.url ?? '',
            method: entry.request?.method ?? 'GET',
        }))
        const streamToken =
            pending.length > 0 ? stashPendingStream(store.cache, pending) : undefined
        /*
        A health() read during this render marked the store: build the payload
        the health route would serve and ship it as the client's seed, so
        hydration starts with the fields and the first poll waits a full
        interval instead of re-probing the server that just delivered this
        document. Built post-render because the app hook may be async while
        the in-render health() read is sync. Unmarked renders ship nothing.
        */
        const health = store.healthRead ? await healthPayload(store.req) : undefined
        const stateTag = `<script>window.__SSR__ = ${safeJsonForScript({
            route: routeUrl,
            params,
            cache: inline,
            streaming,
            streamToken,
            // Omitted at root mount; the client defaults base to ''.
            base: base || undefined,
            /* This request's traceparent — the browser continues the trace that rendered the page. */
            trace: formatTraceparent(store.trace),
            /* The app's default log channel, so client lines speak as [appName] too. */
            app: appNameSlot.name,
            /* The health seed for a render that read health(); absent otherwise. */
            health,
        })};</script>`
        const html = fillShell(rendered, stateTag)
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                Vary: 'Accept',
                'Cache-Control': SSR_CACHE_CONTROL,
            },
        })
    }

    return { renderPage, renderError }
}
