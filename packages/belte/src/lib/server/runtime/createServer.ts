import type { BunRequest, Server } from 'bun'
import type { Component } from 'svelte'
import { render } from 'svelte/server'
import App from '../../../App.svelte'
import type { Errors } from '../../browser/types/Errors.ts'
import type { Layouts } from '../../browser/types/Layouts.ts'
import type { Pages } from '../../browser/types/Pages.ts'
import { createMcpResourceServer } from '../../mcp/createMcpResourceServer.ts'
import { setMcpResourceServer } from '../../mcp/mcpResourceServerSlot.ts'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { NO_STORE, SSR_CACHE_CONTROL } from '../../shared/cacheControlValues.ts'
import { extraForwardHeaders } from '../../shared/extraForwardHeaders.ts'
import { isDebugEnabled } from '../../shared/isDebugEnabled.ts'
import { log } from '../../shared/log.ts'
import { nearestLayoutPrefix, normalizeLayoutPrefixes } from '../../shared/nearestLayoutPrefix.ts'
import { resolveStreamPath } from '../../shared/resolveStreamPath.ts'
import { toBunRoutePattern } from '../../shared/toBunRoutePattern.ts'
import type { AppModule } from '../AppModule.ts'
import { handleCliDownload } from '../cli/handleCliDownload.ts'
import { handleCliInstall } from '../cli/handleCliInstall.ts'
import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'
import { acceptsZstd } from './acceptsZstd.ts'
import { buildOpenApiSpec } from './buildOpenApiSpec.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { containsTraversal } from './containsTraversal.ts'
import { createAssetHeaderCache } from './createAssetHeaderCache.ts'
import { createPublicAssetServer } from './createPublicAssetServer.ts'
import { createRouteDispatcher } from './createRouteDispatcher.ts'
import { disableIdleTimeoutForStream } from './disableIdleTimeoutForStream.ts'
import { globToPathSet } from './globToPathSet.ts'
import { internalErrorResponse } from './internalErrorResponse.ts'
import { isCrossOriginUpgrade } from './isCrossOriginUpgrade.ts'
import { listenOnOpenPort } from './listenOnOpenPort.ts'
import { logExposedSurfaces } from './logExposedSurfaces.ts'
import { parseIdleTimeout } from './parseIdleTimeout.ts'
import { parsePort } from './parsePort.ts'
import { ensureRegistriesLoaded, setRegistryManifests } from './registryManifests.ts'
import { resolveStreamResponse } from './resolveStreamResponse.ts'
import { runWithRequestScope } from './runWithRequestScope.ts'
import { safeJsonForScript } from './safeJsonForScript.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import { setActiveServer } from './setActiveServer.ts'
import { stashPendingStream } from './streamStash.ts'
import type { Assets } from './types/Assets.ts'
import type { RequestStore } from './types/RequestStore.ts'

function wantsJson(req: Request): boolean {
    return (req.headers.get('accept') ?? '').includes('application/json')
}

// SSR placeholders the shell carries; filled in a single pass per render.
const SSR_MARKER = /<!--ssr:(head|body|state)-->/g

const IDENTITY_PATH = '/__belte/identity'
const SOCKETS_PATH = '/__belte/sockets'
const SOCKETS_REST_PREFIX = '/__belte/sockets/'
const MCP_PATH = '/__belte/mcp'
const CLI_PATH = '/__belte/cli'
const CLI_DOWNLOAD_PREFIX = '/__belte/cli/'
/*
Unlike the framework's own plumbing routes above (the socket multiplex, MCP
endpoint, CLI download), the OpenAPI document describes the app's public HTTP
surface — the /rpc/* verbs — rather than belte internals, so it sits at the
conventional root path where external tooling and scanners expect to find it
(/openapi.json, alongside /swagger.json, /.well-known/*) rather than under the
/__belte/ namespace.
*/
const OPENAPI_PATH = '/openapi.json'

/*
Starts a Bun HTTP server that ties together the framework conventions:
page.svelte + layout.svelte under src/browser/pages/ for views, one named export
per file under src/server/rpc/ for verb-bound remote functions, one named export
per file under src/server/sockets/ for broadcast sockets, and an optional
app.ts for boot-time setup, request middleware, and error fallback. Page
URLs and rpc URLs live in disjoint spaces — pages mount at the folder
path, rpc files mount at `/rpc/<file path>` — so each registered URL
resolves to exactly one thing. Per request, an AsyncLocalStorage
RequestStore carries the cache store and request metadata.
*/
export async function createServer({
    pages,
    rpc,
    sockets,
    prompts,
    layouts,
    errors,
    shell,
    app,
    assets,
    publicAssets,
    mcpResources,
    mcp,
    cliProgramName,
    appInfo,
    distDir = `${process.cwd()}/dist`,
    publicDir = `${process.cwd()}/src/browser/public`,
    resourcesDir = `${process.cwd()}/src/mcp/resources`,
    // A configured PORT is honored as-is; left undefined, the real listener
    // scans upward from 3000 at bind time (see buildServer / listenOnOpenPort).
    port = parsePort(process.env.PORT),
    /*
    Bun's per-connection idle timeout in seconds (its own default is 10).
    Surfaced for apps whose unary handlers legitimately compute longer than
    that; streaming responses opt out per-request via disableIdleTimeoutForStream
    regardless of this floor.
    */
    idleTimeout = parseIdleTimeout(process.env.BELTE_IDLE_TIMEOUT) ?? 10,
}: {
    pages: Pages
    rpc: RemoteRoutes
    sockets: SocketRoutes
    prompts: PromptRoutes
    layouts?: Layouts
    errors?: Errors
    shell: string
    app?: AppModule
    assets?: Assets
    publicAssets?: Assets
    mcpResources?: Assets
    mcp?: McpServer
    cliProgramName?: string
    appInfo?: { name: string; version: string }
    distDir?: string
    publicDir?: string
    resourcesDir?: string
    port?: number
    idleTimeout?: number
}): Promise<Server<unknown>> {
    setRegistryManifests({ rpc, sockets, prompts })
    setMcpResourceServer(createMcpResourceServer({ resourcesDir, mcpResources }))
    const cliName = cliProgramName ?? 'app'
    const cliCwd = process.cwd()
    const servePublicAsset = await createPublicAssetServer({ publicDir, publicAssets })
    const layoutPrefixes = layouts ? normalizeLayoutPrefixes(Object.keys(layouts)) : []
    const errorPrefixes = errors ? normalizeLayoutPrefixes(Object.keys(errors)) : []

    /*
    Snapshot the precompressed `.zst` siblings the build wrote next to each
    `_app` asset, keyed by the asset's request path, so a zstd-capable
    client gets the precompressed bytes without on-the-fly compression. Only
    in disk mode (`belte start` / dev); the compiled binary serves from the
    embedded `assets` map instead.
    */
    const diskZstdPaths = assets
        ? new Set<string>()
        : await globToPathSet(
              `${distDir}/_app`,
              '**/*.zst',
              (file) => `/_app/${file.replace(/\.zst$/, '')}`,
          )

    const logRequests = isDebugEnabled('belte')

    // App-configured headers extend the in-process forward allowlist for the process lifetime.
    extraForwardHeaders.set(app?.forwardHeaders ?? [])

    // Per-pathname asset header bundles, hashed-chunk-aware Cache-Control.
    const headersForAsset = createAssetHeaderCache(cacheControlForAsset)

    async function serveStaticAsset(req: Request, url: URL): Promise<Response> {
        /*
        Defence-in-depth path-traversal check against the raw request URL.
        The WHATWG URL parser decodes `%2E%2E` to `..` and then normalises
        dot-segments away before `url.pathname` is even visible, so an
        attacker's traversal sequence would be invisible if we only looked
        at the parsed pathname. Inspecting `req.url` instead catches the
        encoded forms before normalization eats them; `%2F` (encoded slash)
        is preserved in the pathname but still flagged here for clarity.
        */
        if (containsTraversal(req.url)) {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Cache-Control': NO_STORE },
            })
        }
        const wantsZstd = acceptsZstd(req)
        const { base: baseHeaders, zstd: zstdHeaders } = headersForAsset(url.pathname)
        if (assets) {
            const compressed = assets[url.pathname]
            if (!compressed) {
                return new Response('Not Found', {
                    status: 404,
                    headers: { 'Cache-Control': NO_STORE },
                })
            }
            if (wantsZstd) {
                return new Response(compressed, { headers: zstdHeaders })
            }
            return new Response(await Bun.zstdDecompress(compressed), { headers: baseHeaders })
        }
        const diskPath = distDir + url.pathname
        if (wantsZstd && diskZstdPaths.has(url.pathname)) {
            return new Response(Bun.file(`${diskPath}.zst`), { headers: zstdHeaders })
        }
        return new Response(Bun.file(diskPath), { headers: baseHeaders })
    }

    /* Splices the rendered head/body and a state <script> into the shell's SSR markers. */
    function fillShell(rendered: Awaited<ReturnType<typeof render>>, stateTag: string): string {
        const fills: Record<string, string> = {
            head: rendered.head,
            body: rendered.body,
            state: stateTag,
        }
        return shell.replace(SSR_MARKER, (_match, key: string) => fills[key])
    }

    /*
    Renders the nearest error.svelte for a failed page navigation — an unknown
    route (404) or a throw during a page render. Walks up from the requested
    pathname to the deepest error.svelte ancestor (nearest-only, like layouts)
    and renders it inside the nearest layout with `{ status, message, stack }`
    props. Returns undefined when no error.svelte covers the path, so the caller
    falls back to its plain Response (the 404 text) or rethrows (→
    app.handleError). The document is static — it ships `__SSR__.error` so the
    client skips hydration (there is no client route for an error view to
    hydrate against).

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
        if (!errors) {
            return undefined
        }
        const pathname = store.url.pathname
        const errorPrefix = nearestLayoutPrefix(pathname, errorPrefixes)
        if (!errorPrefix) {
            return undefined
        }
        const layoutPrefix = nearestLayoutPrefix(pathname, layoutPrefixes)
        const [errorMod, layoutMod] = await Promise.all([
            errors[errorPrefix](),
            layoutPrefix && layouts ? layouts[layoutPrefix]() : Promise.resolve(undefined),
        ])
        const ErrorView = errorMod.default as Component
        const Layout = layoutMod?.default as Component | undefined
        const rendered = await render(App, {
            props: {
                state: {
                    page: {
                        route: pathname,
                        // status is a number (and stack optional); the page-params
                        // shape is string-keyed generically, so the error props
                        // ride through to the component as-is.
                        params: { status, message, stack } as unknown as Record<string, string>,
                        url: store.url,
                    },
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
            const message = error instanceof Error ? error.message : String(error)
            const stack = error instanceof Error ? error.stack : undefined
            const rendered = await renderError(500, message, store, stack)
            if (rendered) {
                log.error(error)
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
        const layoutPrefix = nearestLayoutPrefix(routeUrl, layoutPrefixes)
        const [pageMod, layoutMod] = await Promise.all([
            pages[routeUrl](),
            layoutPrefix && layouts ? layouts[layoutPrefix]() : Promise.resolve(undefined),
        ])
        const Page = pageMod.default as Component
        const Layout = layoutMod?.default as Component | undefined
        const rendered = await render(App, {
            props: {
                state: {
                    page: {
                        route: routeUrl,
                        params,
                        url: store.url,
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
        const stateTag = `<script>window.__SSR__ = ${safeJsonForScript({
            route: routeUrl,
            params,
            cache: inline,
            streaming,
            streamToken,
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

    /*
    Route dispatch — rpc-vs-page-vs-404 resolution and method matching — lives
    behind createRouteDispatcher; renderPage is injected so those decisions stay
    testable without SSR. buildRoutes() below binds the returned handler per URL.
    */
    const buildRouteHandler = createRouteDispatcher({ pages, rpc, renderPage })

    /*
    Page URLs (folder paths, e.g. `/media/[id]`) get translated to Bun's
    pattern syntax (`/media/:id`) at registration. Bun's `*` wildcard
    matches but does not capture into req.params, so for `[...rest]`
    routes the catch-all value is reconstructed from the request URL by
    slicing the pathname segments after the catch-all's pattern index.
    The reconstructed value is set under the original name (e.g. `rest`)
    so the page component's $props destructure stays consistent with the
    file path. Page URLs and rpc URLs (always `/rpc/...`, flat) are
    disjoint by construction, so a plain object needs no deduplication.
    */
    const routes: Record<string, (req: BunRequest) => Promise<Response>> = {}
    for (const routeUrl of Object.keys(pages)) {
        const handler = buildRouteHandler(routeUrl)
        const { pattern, catchAllName } = toBunRoutePattern(routeUrl)
        const catchAllIndex = catchAllName
            ? routeUrl.split('/').findIndex((segment) => segment.startsWith('[...'))
            : -1
        routes[pattern] = (req) => {
            const pathParams = { ...((req.params as Record<string, string> | undefined) ?? {}) }
            if (catchAllName && catchAllIndex !== -1) {
                const pathSegments = new URL(req.url).pathname.split('/')
                pathParams[catchAllName] = pathSegments.slice(catchAllIndex).join('/')
            }
            return dispatchRequest(req, pathParams, handler)
        }
    }
    for (const routeUrl of Object.keys(rpc)) {
        const handler = buildRouteHandler(routeUrl)
        routes[routeUrl] = (req) => dispatchRequest(req, {}, handler)
    }

    function dispatchRequest(
        req: Request,
        pathParams: Record<string, string>,
        handler: (
            req: Request,
            pathParams: Record<string, string>,
            store: RequestStore,
        ) => Promise<Response>,
    ): Promise<Response> {
        return runWithRequestScope(req, { app, logRequests }, async (store) => {
            const response = app?.handle
                ? await app.handle(req, (next) => handler(next, pathParams, store))
                : await handler(req, pathParams, store)
            // Streaming bodies (sse/jsonl, socket tail) opt out of the idle timeout.
            return disableIdleTimeoutForStream(server, req, response)
        })
    }

    /*
    Belte's only native WebSocket surface is the sockets hub: every Socket
    declared under src/server/sockets/ multiplexes onto one framework-owned
    connection per client at /__belte/sockets. The dispatcher owns the
    open/message/close handlers below; user code never sees the raw ws
    lifecycle. Steady-state fan-out rides Bun's native server.publish so
    a busy socket doesn't iterate JS per subscriber per message.
    */
    const socketDispatcher = createSocketDispatcher(sockets)

    /*
    Bind the real server on `boundPort`. Only the port varies between scan
    attempts, so the rest of the config lives inline and just the port is spread
    in — passing the literal straight to Bun.serve keeps contextual typing of the
    websocket handlers (and Server<unknown> pins Bun's WebSocketData generic so
    upgrade({ data: {} }) typechecks).
    */
    const bindAt = (boundPort: number): Server<unknown> =>
        Bun.serve({
            port: boundPort,
            idleTimeout,

            websocket: {
                open(ws) {
                    socketDispatcher.open(ws)
                },
                message(ws, data) {
                    socketDispatcher.message(ws, data)
                },
                close(ws) {
                    socketDispatcher.close(ws)
                },
            },

            routes,

            async fetch(req, bunServer) {
                const url = new URL(req.url)
                /*
                Identity probe — answered directly, ahead of any app.handle middleware,
                so the bundle's connect screen can confirm a URL really is a belte
                server (and which app) before pointing the desktop window at it. It
                must stay reachable even when the app guards everything behind auth,
                hence the early return that bypasses dispatchRequest.
                */
                if (url.pathname === IDENTITY_PATH) {
                    return Response.json(
                        {
                            belte: true,
                            name: appInfo?.name ?? cliName,
                            version: appInfo?.version ?? '0.0.0',
                        },
                        { headers: { 'Cache-Control': NO_STORE } },
                    )
                }
                if (url.pathname === SOCKETS_PATH) {
                    // Reject cross-origin upgrades (CSWSH) before handing off to Bun.
                    if (isCrossOriginUpgrade(req, url)) {
                        return new Response('Forbidden', { status: 403 })
                    }
                    if (bunServer.upgrade(req, { data: {} })) {
                        return undefined as unknown as Response
                    }
                    return new Response('Upgrade failed', { status: 400 })
                }
                /*
                HTTP face of a socket (`/__belte/sockets/<name>`) — tail over
                SSE / JSON and publish — for the CLI and MCP. Runs through
                dispatchRequest so app.handle auth applies, like the rpc paths.
                The socket name may contain `/` (nested files), so it's the
                whole remaining pathname, percent-decoded.
                */
                if (url.pathname.startsWith(SOCKETS_REST_PREFIX)) {
                    const name = decodeURIComponent(url.pathname.slice(SOCKETS_REST_PREFIX.length))
                    return dispatchRequest(req, {}, async () => socketDispatcher.rest(req, name))
                }
                /*
                Out-of-band resolution stream for a streamed page's pending
                {#await} reads. Answered directly (no app.handle / request scope):
                it drains promises stashed during SSR, and the random single-use
                token gates access. Returning here bypasses
                disableIdleTimeoutForStream so it inherits the bounded idleTimeout
                rather than the long-lived-stream disable.
                */
                if (url.pathname.startsWith(resolveStreamPath)) {
                    return resolveStreamResponse(url.pathname.slice(resolveStreamPath.length))
                }
                if (url.pathname === MCP_PATH && mcp) {
                    return dispatchRequest(req, {}, async () => mcp.handle(req))
                }
                if (url.pathname === CLI_PATH) {
                    return dispatchRequest(req, {}, async () => handleCliInstall(req, cliName))
                }
                if (url.pathname.startsWith(CLI_DOWNLOAD_PREFIX)) {
                    const platform = url.pathname.slice(CLI_DOWNLOAD_PREFIX.length)
                    return dispatchRequest(req, {}, async () =>
                        handleCliDownload(req, platform, cliName, cliCwd),
                    )
                }
                if (url.pathname === OPENAPI_PATH) {
                    return dispatchRequest(req, {}, async () => {
                        await ensureRegistriesLoaded()
                        const spec = buildOpenApiSpec({
                            title: appInfo?.name ?? cliName,
                            version: appInfo?.version ?? '0.0.0',
                        })
                        return Response.json(spec, { headers: { 'Cache-Control': NO_STORE } })
                    })
                }
                /*
                Static assets sidestep ALS + the per-request CacheStore + the
                app.handle middleware: they have no need for cache() and the
                allocation overhead matters on a cold page load that pulls
                dozens of chunks. The global server.error() handler still
                catches anything that goes wrong inside serveStaticAsset.
                */
                if (url.pathname.startsWith('/_app/')) {
                    if (!logRequests) {
                        return serveStaticAsset(req, url)
                    }
                    const start = Bun.nanoseconds()
                    const response = await serveStaticAsset(req, url)
                    const ms = (Bun.nanoseconds() - start) / 1e6
                    log.request(req.method, `${url.pathname}${url.search}`, response.status, ms)
                    return response
                }
                /*
                Files under public/ are served at the site root, sidestepping
                ALS + middleware like the /_app/ assets do. A miss returns
                undefined so the request falls through to the 404 / middleware
                path below.
                */
                const publicResponse = await servePublicAsset(req, url)
                if (publicResponse) {
                    if (logRequests) {
                        log.request(
                            req.method,
                            `${url.pathname}${url.search}`,
                            publicResponse.status,
                            0,
                        )
                    }
                    return publicResponse
                }
                /*
                Unknown routes still run through dispatchRequest so user-defined
                app.handle middleware can rewrite the request, serve a custom
                404, or branch on the URL. The inner handler returns the
                framework's default 404 when nothing intervenes.
                */
                return dispatchRequest(req, {}, async (_req, _pathParams, store) => {
                    return (
                        (await renderError(404, 'Not Found', store)) ??
                        new Response('Not Found', {
                            status: 404,
                            headers: { 'Cache-Control': NO_STORE },
                        })
                    )
                })
            },

            error(err) {
                log.error(err)
                return internalErrorResponse(err)
            },
        })

    /*
    A configured PORT binds that exact port — a collision surfaces loudly rather
    than silently moving, since something connecting to the app needs a known
    address. With none set, scan upward from 3000 binding the real listener, so
    whichever server wins the port keeps it (no probe-release gap to lose it in,
    which used to crash boot on EADDRINUSE instead of stepping to the next port).
    */
    const server: Server<unknown> =
        port === undefined ? listenOnOpenPort(bindAt, 3000) : bindAt(port)

    /*
    Publishes the live server through `belte/server` before invoking the
    user's init() hook. The exported `server()` function reads from this
    slot and throws on access before the slot is set, so init() callers
    can hold the import at module scope and still see the real instance
    once boot completes.
    */
    setActiveServer(server)

    const cleanup = app?.init ? await app.init({ server }) : undefined
    /*
    Close the listener deterministically on shutdown. Always registered (even
    with no init cleanup) so the socket is released via server.stop rather than
    left to abrupt process exit — which leaves the port in TIME_WAIT and races
    a fast restart. A watchdog force-exits if a user cleanup hangs, so a stuck
    cleanup can't keep the process (and its port) alive.
    */
    const shutdown = async () => {
        server.stop(true)
        if (typeof cleanup === 'function') {
            setTimeout(() => process.exit(0), 3000).unref()
            try {
                await cleanup()
            } catch (err) {
                log.error(err)
            }
        }
        process.exit(0)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)

    log.success(`ready at http://localhost:${server.port}`)
    /*
    Diagnostic only, and only under `belte` debug logging — eager-loads the
    registry to print the per-rpc surface map (which verbs reach mcp/cli/
    openapi), making belte's multimodal-by-default exposure auditable.
    */
    if (logRequests) {
        void logExposedSurfaces()
    }
    return server
}
