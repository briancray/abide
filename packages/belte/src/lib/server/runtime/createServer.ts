import type { BunRequest, Server } from 'bun'
import type { Errors } from '../../browser/types/Errors.ts'
import type { Layouts } from '../../browser/types/Layouts.ts'
import type { Pages } from '../../browser/types/Pages.ts'
import { createMcpResourceServer } from '../../mcp/createMcpResourceServer.ts'
import { setMcpResourceServer } from '../../mcp/mcpResourceServerSlot.ts'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { basePathFromAppUrl } from '../../shared/basePathFromAppUrl.ts'
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { createViewResolver } from '../../shared/createViewResolver.ts'
import { extraForwardHeaders } from '../../shared/extraForwardHeaders.ts'
import { isDebugEnabled } from '../../shared/isDebugEnabled.ts'
import { isReadOnlyMethod } from '../../shared/isReadOnlyMethod.ts'
import { log } from '../../shared/log.ts'
import { RESOLVE_STREAM_PATH } from '../../shared/RESOLVE_STREAM_PATH.ts'
import { setBaseResolver } from '../../shared/setBaseResolver.ts'
import { toBunRoutePattern } from '../../shared/toBunRoutePattern.ts'
import type { HttpVerb } from '../../shared/types/HttpVerb.ts'
import type { AppModule } from '../AppModule.ts'
import { handleCliDownload } from '../cli/handleCliDownload.ts'
import { handleCliInstall } from '../cli/handleCliInstall.ts'
import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'
import { buildOpenApiSpec } from './buildOpenApiSpec.ts'
import { createAppAssetServer } from './createAppAssetServer.ts'
import { createPageRenderer } from './createPageRenderer.ts'
import { createPublicAssetServer } from './createPublicAssetServer.ts'
import { createRouteDispatcher } from './createRouteDispatcher.ts'
import { crossOriginForbidden } from './crossOriginForbidden.ts'
import { DEFAULT_PORT } from './DEFAULT_PORT.ts'
import { DEV_REBUILD_MESSAGE } from './DEV_REBUILD_MESSAGE.ts'
import { DEV_RELOAD_CLIENT_SCRIPT } from './DEV_RELOAD_CLIENT_SCRIPT.ts'
import { devReloadResponse } from './devReloadResponse.ts'
import { disableIdleTimeoutForStream } from './disableIdleTimeoutForStream.ts'
import { internalErrorResponse } from './internalErrorResponse.ts'
import { isCrossOriginRequest } from './isCrossOriginRequest.ts'
import { listenOnOpenPort } from './listenOnOpenPort.ts'
import { logExposedSurfaces } from './logExposedSurfaces.ts'
import { parseIdleTimeout } from './parseIdleTimeout.ts'
import { parsePort } from './parsePort.ts'
import { ensureRegistriesLoaded, setRegistryManifests } from './registryManifests.ts'
import { resolveStreamResponse } from './resolveStreamResponse.ts'
import { runWithRequestScope } from './runWithRequestScope.ts'
import { setActiveServer } from './setActiveServer.ts'
import type { Assets } from './types/Assets.ts'
import type { RequestStore } from './types/RequestStore.ts'
import { warnUnguardedMcp } from './warnUnguardedMcp.ts'

const IDENTITY_PATH = '/__belte/identity'
const SOCKETS_PATH = '/__belte/sockets'
const SOCKETS_REST_PREFIX = '/__belte/sockets/'
const MCP_PATH = '/__belte/mcp'
const CLI_PATH = '/__belte/cli'
const CLI_DOWNLOAD_PREFIX = '/__belte/cli/'
// Dev-only live-reload SSE channel; mounted only when `dev` (see devEntry orchestrator).
const DEV_RELOAD_PATH = '/__belte/dev'
// Dev-only manual rebuild trigger; POSTing signals the orchestrator to rebuild + restart.
const DEV_REBUILD_PATH = '/__belte/reload'
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
    // Under `belte dev` the orchestrator sets this: mount the live-reload SSE
    // channel and inject its client into the served shell.
    dev = false,
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
    dev?: boolean
}): Promise<Server<unknown>> {
    // In dev, append the live-reload client to the shell so every rendered
    // page reconnects to /__belte/dev and reloads after a restart.
    const activeShell = dev ? shell.replace('</body>', `${DEV_RELOAD_CLIENT_SCRIPT}</body>`) : shell
    setRegistryManifests({ rpc, sockets, prompts })
    setMcpResourceServer(createMcpResourceServer({ resourcesDir, mcpResources }))
    const cliName = cliProgramName ?? 'app'
    const cliCwd = process.cwd()
    const servePublicAsset = await createPublicAssetServer({ publicDir, publicAssets })
    /* Route → components: layout/error prefix matching + module loading live behind this seam. */
    const viewResolver = createViewResolver({ pages, layouts, errors })

    // Build-tree assets: embedded zstd map (compiled binary) or dist/ on disk.
    const serveAppAsset = await createAppAssetServer({ distDir, assets })

    const logRequests = isDebugEnabled('belte')

    // App-configured headers extend the in-process forward allowlist for the process lifetime.
    extraForwardHeaders.set(app?.forwardHeaders ?? [])

    /*
    SSR document assembly — view render, cache snapshot partition, `__SSR__`
    state tag, shell splicing — lives behind createPageRenderer. renderError
    also serves the 404 fallthrough below.
    */
    const { renderPage, renderError } = createPageRenderer({ shell: activeShell, viewResolver })

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
                /*
                Dev live-reload channel — answered directly, ahead of app.handle,
                so a restart-driven reconnect always lands even when the app guards
                everything behind auth. Only mounted under `belte dev`.
                */
                if (dev && url.pathname === DEV_RELOAD_PATH) {
                    // Long-lived SSE: opt out of the idle timeout, else Bun reaps
                    // it and the reconnect triggers a spurious reload loop.
                    return disableIdleTimeoutForStream(bunServer, req, devReloadResponse())
                }
                /*
                Manual rebuild trigger: signal the orchestrator parent over IPC to
                rebuild + restart. Same-origin sibling of the live-reload channel, so
                a script refreshes on the app's own port. process.send exists only when
                the dev orchestrator spawned us with ipc; the optional chain no-ops on a
                bare server.
                */
                if (dev && req.method === 'POST' && url.pathname === DEV_REBUILD_PATH) {
                    process.send?.(DEV_REBUILD_MESSAGE)
                    return new Response('rebuilding\n')
                }
                if (url.pathname === SOCKETS_PATH) {
                    // Reject cross-origin upgrades (CSWSH) before handing off to Bun.
                    if (isCrossOriginRequest(req, url)) {
                        return crossOriginForbidden()
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
                    /*
                    Reject cross-origin browser publishes (CSRF) like the socket
                    upgrade and MCP above — `rest` reads req.json() ignoring
                    Content-Type, so a hostile page's text/plain POST could
                    otherwise publish to a `clientPublish` socket with the
                    visitor's ambient cookies. GET tail reads stay open
                    cross-origin like rpc reads; only the mutating POST is gated.
                    */
                    if (
                        !isReadOnlyMethod(req.method as HttpVerb) &&
                        isCrossOriginRequest(req, url)
                    ) {
                        return crossOriginForbidden()
                    }
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
                if (url.pathname.startsWith(RESOLVE_STREAM_PATH)) {
                    return resolveStreamResponse(url.pathname.slice(RESOLVE_STREAM_PATH.length))
                }
                if (url.pathname === MCP_PATH && mcp) {
                    /*
                    Reject cross-site browser posts (CSRF) like the socket
                    upgrade above. The JSON-RPC parse ignores Content-Type, so
                    a hostile page's text/plain form trick could otherwise
                    smuggle an envelope here with the visitor's ambient
                    cookies. Native MCP clients send no Origin and pass.
                    */
                    if (isCrossOriginRequest(req, url)) {
                        return crossOriginForbidden()
                    }
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
                catches anything that goes wrong inside serveAppAsset.
                */
                if (url.pathname.startsWith('/_app/')) {
                    if (!logRequests) {
                        return serveAppAsset(req, url)
                    }
                    const start = Bun.nanoseconds()
                    const response = await serveAppAsset(req, url)
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
        port === undefined ? listenOnOpenPort(bindAt, DEFAULT_PORT) : bindAt(port)

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

    /*
    Diagnostic only, and only under `belte` debug logging — eager-loads the
    registry to print the page/socket/rpc surface maps (routing + which
    declarations reach mcp/cli/openapi), making belte's multimodal-by-default
    exposure auditable. Awaited so `ready` lands after all of belte's own
    startup output rather than interleaving with it.
    */
    if (logRequests) {
        await logExposedSurfaces({ pages, resolver: viewResolver })
    }
    // Unguarded machine surface check — app.handle is the blessed auth seam.
    if (mcp && !app?.handle) {
        await warnUnguardedMcp()
    }
    log.success(`ready at http://localhost:${server.port}`)
    return server
}
