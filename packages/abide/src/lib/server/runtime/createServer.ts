import type { BunRequest, Server } from 'bun'
import { createMcpResourceServer } from '../../mcp/createMcpResourceServer.ts'
import { setMcpResourceServer } from '../../mcp/mcpResourceServerSlot.ts'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { abideLog } from '../../shared/abideLog.ts'
import { basePathFromAppUrl } from '../../shared/basePathFromAppUrl.ts'
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { CLI_PATH } from '../../shared/CLI_PATH.ts'
import { DEV_HOT_PREFIX } from '../../shared/DEV_HOT_PREFIX.ts'
import { DEV_RELOAD_PATH } from '../../shared/DEV_RELOAD_PATH.ts'
import { extraForwardHeaders } from '../../shared/extraForwardHeaders.ts'
import { HEALTH_PATH } from '../../shared/HEALTH_PATH.ts'
import { healthReadSlot } from '../../shared/healthReadSlot.ts'
import { IDENTITY_PATH } from '../../shared/IDENTITY_PATH.ts'
import { INSPECTOR_PATH } from '../../shared/INSPECTOR_PATH.ts'
import { isDebugNegated } from '../../shared/isDebugNegated.ts'
import { logClosingRecord } from '../../shared/logClosingRecord.ts'
import { OFFLINE_HEADER } from '../../shared/OFFLINE_HEADER.ts'
import { parseBoundedEnvInt } from '../../shared/parseBoundedEnvInt.ts'
import { SOCKETS_PATH } from '../../shared/SOCKETS_PATH.ts'
import { setAppName } from '../../shared/setAppName.ts'
import { setBaseResolver } from '../../shared/setBaseResolver.ts'
import { setRequestScopeResolver } from '../../shared/setRequestScopeResolver.ts'
import { TEXT_PLAIN } from '../../shared/TEXT_PLAIN.ts'
import { toBunRoutePattern } from '../../shared/toBunRoutePattern.ts'
import type { Layouts } from '../../ui/types/Layouts.ts'
import type { Pages } from '../../ui/types/Pages.ts'
import type { AppModule } from '../AppModule.ts'
import { handleCliDownload } from '../cli/handleCliDownload.ts'
import { handleCliInstall } from '../cli/handleCliInstall.ts'
import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'
import { buildHealthPayload } from './buildHealthPayload.ts'
import { buildOpenApiSpec } from './buildOpenApiSpec.ts'
import { buildPreloadManifest } from './buildPreloadManifest.ts'
import { createAppAssetServer } from './createAppAssetServer.ts'
import { createPublicAssetServer } from './createPublicAssetServer.ts'
import { createRouteDispatcher } from './createRouteDispatcher.ts'
import { createUiPageRenderer } from './createUiPageRenderer.ts'
import { crossOriginGate } from './crossOriginGate.ts'
import { DEFAULT_PORT } from './DEFAULT_PORT.ts'
import { DEV_READY_MESSAGE } from './DEV_READY_MESSAGE.ts'
import { DEV_REBUILD_MESSAGE } from './DEV_REBUILD_MESSAGE.ts'
import { DEV_RELOAD_CLIENT_SCRIPT } from './DEV_RELOAD_CLIENT_SCRIPT.ts'
import { devClientFingerprint } from './devClientFingerprint.ts'
import { devHotModuleResponse } from './devHotModuleResponse.ts'
import { devReloadResponse } from './devReloadResponse.ts'
import { disableIdleTimeoutForStream } from './disableIdleTimeoutForStream.ts'
import { gzipResponse } from './gzipResponse.ts'
import { internalErrorResponse } from './internalErrorResponse.ts'
import { listenOnOpenPort } from './listenOnOpenPort.ts'
import { logExposedSurfaces } from './logExposedSurfaces.ts'
import { maybeMountInspector } from './maybeMountInspector.ts'
import { parseIdleTimeout } from './parseIdleTimeout.ts'
import { parsePort } from './parsePort.ts'
import { ensureRegistriesLoaded, setRegistryManifests } from './registryManifests.ts'
import { requestContext } from './requestContext.ts'
import { runWithRequestScope } from './runWithRequestScope.ts'
import { setActiveServer } from './setActiveServer.ts'
import type { Assets } from './types/Assets.ts'
import type { RequestStore } from './types/RequestStore.ts'
import { warnUnguardedMcp } from './warnUnguardedMcp.ts'

const SOCKETS_REST_PREFIX = `${SOCKETS_PATH}/`
const MCP_PATH = '/__abide/mcp'
const CLI_DOWNLOAD_PREFIX = `${CLI_PATH}/`
// Dev-only manual rebuild trigger; POSTing signals the orchestrator to rebuild + restart.
const DEV_REBUILD_PATH = '/__abide/reload'
/*
Unlike the framework's own plumbing routes above (the socket multiplex, MCP
endpoint, CLI download), the OpenAPI document describes the app's public HTTP
surface — the /rpc/* rpcs — rather than abide internals, so it sits at the
conventional root path where external tooling and scanners expect to find it
(/openapi.json, alongside /swagger.json, /.well-known/*) rather than under the
/__abide/ namespace.
*/
const OPENAPI_PATH = '/openapi.json'

/*
Starts a Bun HTTP server that ties together the framework conventions:
page.abide under src/ui/pages/ for views (layout.abide wraps the pages beneath
it), one named export per file under src/server/rpc/ for rpc-bound remote
functions, one named export
per file under src/server/sockets/ for broadcast sockets, and an optional
app.ts for boot-time setup, request middleware, and error fallback. Page
URLs and rpc URLs live in disjoint spaces — pages mount at the folder
path, rpc files mount at `/rpc/<file path>` — so each registered URL
resolves to exactly one thing. Per request, an AsyncLocalStorage
RequestStore carries the cache store and request metadata.
*/
export async function createServer({
    pages,
    layouts = {},
    rpc,
    sockets,
    prompts,
    shell,
    app,
    assets,
    publicAssets,
    mcpResources,
    mcp,
    cliProgramName,
    appInfo,
    distDir = `${process.cwd()}/dist`,
    publicDir = `${process.cwd()}/src/ui/public`,
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
    idleTimeout = parseIdleTimeout(process.env.ABIDE_IDLE_TIMEOUT) ?? 10,
    /*
    Bun's server-wide request body ceiling, enforced natively by Bun.serve
    (its own default is ~128MB). Surfaced as an option + env so deployments
    can raise/lower it; per-rpc tightening is the rpcs' maxBodySize.
    */
    maxRequestBodySize = parseBoundedEnvInt(
        process.env.ABIDE_MAX_REQUEST_BODY_SIZE,
        0,
        Number.MAX_SAFE_INTEGER,
    ),
    // Under `abide dev` the orchestrator sets this: mount the live-reload SSE
    // channel and inject its client into the served shell.
    dev = false,
}: {
    pages: Pages
    layouts?: Layouts
    rpc: RemoteRoutes
    sockets: SocketRoutes
    prompts: PromptRoutes
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
    maxRequestBodySize?: number
    dev?: boolean
}): Promise<Server<unknown>> {
    /*
    Publish the ALS request scope to the shared layer: trace() and log line
    prefixes resolve through this. Registered here (not serverEntry) so the
    HTTP test harness gets the same behaviour as a real boot. elapsedMs is
    computed at read time so every log line carries a current value.
    */
    setRequestScopeResolver(() => {
        const store = requestContext.getStore()
        if (!store) {
            return undefined
        }
        return {
            trace: store.trace,
            elapsedMs: (Bun.nanoseconds() - store.start) / 1e6,
            method: store.req.method,
            path: store.url.pathname,
            /* The calling client's reported connectivity — drives server-side online(). Absent header = online. */
            online: !store.req.headers.has(OFFLINE_HEADER),
        }
    })
    /*
    health() during an SSR render marks its request through this slot; the
    renderer stamps the health payload into __SSR__ only for marked requests,
    so the client seed stays reader-driven like the poll itself.
    */
    healthReadSlot.mark = () => {
        const store = requestContext.getStore()
        if (store) {
            store.healthRead = true
        }
    }
    // In dev, append the live-reload client to the shell so every rendered
    // page reconnects to /__abide/dev and reloads after a restart.
    const devShell = dev ? shell.replace('</body>', `${DEV_RELOAD_CLIENT_SCRIPT}</body>`) : shell
    // When the inspector is enabled, flag the client so startClient installs the
    // BroadcastChannel bridge that streams scope + router state to the inspector
    // page. Independent of dev — the inspector can run on a build server too.
    const inspectedShell =
        process.env.ABIDE_ENABLE_INSPECTOR === 'true'
            ? devShell.replace('</body>', `<script>window.__abideInspect=true</script></body>`)
            : devShell
    /*
    Mount base from APP_URL's pathname (e.g. https://foo.com/v2 → /v2). Install
    the server-side resolver so url() prefixes SSR-generated links, and rewrite
    the shell's framework `/_app` entry + css refs to carry the base — relative
    code-split chunks inherit it from the entry's own URL. '' (root mount) is a
    no-op on both. See setBaseResolver / startClient for the client half.
    */
    const base = basePathFromAppUrl(process.env.APP_URL)
    setBaseResolver(() => base)
    // Rebase the shell's rooted `/_app/` entry refs onto the mount base, matching
    // either quote style so a custom app.html using single quotes still rewrites.
    const activeShell = base
        ? inspectedShell.replace(/(["'])\/_app\//g, `$1${base}/_app/`)
        : inspectedShell
    /*
    Boot-path disk scans run concurrently — they share no data, and under
    `abide dev` the worker-swap window is bounded by exactly this boot.
    devClientFingerprint (dev only) hashes the browser-visible surface so the
    live-reload channel reloads only when a worker swap changed what the
    browser would render; the asset servers glob public/ and the build tree
    (embedded gzip map in a compiled binary, dist/ on disk).
    */
    const [clientFingerprint, servePublicAsset, serveAppAsset, routePreloads] = await Promise.all([
        dev
            ? devClientFingerprint({
                  srcDir: `${process.cwd()}/src`,
                  publicDir,
                  shell: activeShell,
                  projectRoot: process.cwd(),
              })
            : undefined,
        createPublicAssetServer({ publicDir, publicAssets }),
        createAppAssetServer({ distDir, assets }),
        buildPreloadManifest({ distDir, assets }),
    ])
    setRegistryManifests({ rpc, sockets, prompts })
    setMcpResourceServer(createMcpResourceServer({ resourcesDir, mcpResources }))
    const cliName = cliProgramName ?? 'app'
    /* The app's public identity, shared by the identity probe and the OpenAPI spec. */
    const appName = appInfo?.name ?? cliName
    const appVersion = appInfo?.version ?? '0.0.0'
    /* The app's default log channel — every unchanneled record speaks as [appName]. */
    setAppName(appName)
    /*
    Opt-in inspector (ABIDE_ENABLE_INSPECTOR=true): a dynamically-imported
    `@abide/inspector` handler, or undefined when the flag is off / the package
    isn't installed. Resolved at boot so the fetch route below can branch on it.
    */
    const inspectorHandler = await maybeMountInspector({ name: appName, version: appVersion })
    /* Built on first request, then reused — the rpc registry is frozen after load. */
    let openApiSpec: ReturnType<typeof buildOpenApiSpec> | undefined
    const cliCwd = process.cwd()

    /* Request closing records are on by default — DEBUG=-abide is the off switch (negation, like the abide channel itself). */
    const logRequests = !isDebugNegated('abide')

    /*
    Time an asset serve and emit its closing record when logging is on. A miss
    (undefined, from the public server) passes through unlogged so the request
    can fall through to the 404 path.
    */
    const timedServe = async <T extends Response | undefined>(
        serve: () => Promise<T>,
        req: Request,
        url: URL,
    ): Promise<T> => {
        if (!logRequests) {
            return serve()
        }
        const start = Bun.nanoseconds()
        const response = await serve()
        if (response) {
            logClosingRecord(
                req.method,
                `${url.pathname}${url.search}`,
                response.status,
                (Bun.nanoseconds() - start) / 1e6,
            )
        }
        return response
    }

    // App-configured headers extend the in-process forward allowlist for the process lifetime.
    extraForwardHeaders.set(app?.forwardHeaders ?? [])

    /*
    SSR document assembly — abide-ui page render wrapped in its layout chain, cache
    snapshot, `__SSR__` state tag, shell splicing (buffered, or streamed for pages
    with await blocks) — lives behind createUiPageRenderer. Error pages are not
    framework-resolved; renderError returns undefined and the 404 path serves plain.
    */
    const { renderPage, renderError } = createUiPageRenderer({
        shell: activeShell,
        base,
        clientTimeout: parseBoundedEnvInt(process.env.ABIDE_CLIENT_TIMEOUT, 1, 600_000),
        pages,
        layouts,
        routePreloads,
        /* The wire payload, rebuilt per marked render — the __SSR__ health seed must match what /__abide/health serves. */
        healthPayload: (request) => buildHealthPayload(request, { app, appName, appVersion }),
    })

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
        /* Only catch-all routes copy req.params (to write the reconstructed
           segment); plain routes pass it through — it's never mutated downstream. */
        routes[pattern] =
            catchAllName && catchAllIndex !== -1
                ? (req) => {
                      const pathParams = {
                          ...((req.params as Record<string, string> | undefined) ?? {}),
                      }
                      const url = new URL(req.url)
                      pathParams[catchAllName] = url.pathname
                          .split('/')
                          .slice(catchAllIndex)
                          .join('/')
                      return dispatchRequest(req, pathParams, handler, url)
                  }
                : (req) =>
                      dispatchRequest(
                          req,
                          (req.params as Record<string, string> | undefined) ?? {},
                          handler,
                      )
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
        /* Pre-parsed by the fetch fallback; routes-table callers omit it. */
        url?: URL,
    ): Promise<Response> {
        return runWithRequestScope(req, { app, logRequests, url }, async (store) => {
            const response = app?.handle
                ? await app.handle(req, (next) => handler(next, pathParams, store))
                : await handler(req, pathParams, store)
            /* Gzip compressible dynamic bodies (SSR HTML, rpc/json, 404) when the
               client accepts it; streaming frame protocols and static assets are
               passed through untouched (see gzipResponse). */
            const encoded = gzipResponse(req, response)
            // Streaming bodies (sse/jsonl, socket tail) opt out of the idle timeout.
            return disableIdleTimeoutForStream(server, req, encoded)
        })
    }

    /*
    Abide's only native WebSocket surface is the sockets hub: every Socket
    declared under src/server/sockets/ multiplexes onto one framework-owned
    connection per client at /__abide/sockets. The dispatcher owns the
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
            maxRequestBodySize,
            /*
            Dev workers overlap during a restart: the replacement binds while its
            predecessor still serves, and the kernel keeps delivering connections
            to the old listener until it stops — the port never refuses a request
            mid-swap. Dev-only: in production a port collision should fail loudly.
            */
            reusePort: dev,

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
                Health/identity probe — answered directly, ahead of any app.handle
                middleware, so the bundle's connect screen, the CLI, and the client
                health() can confirm a URL really is a live abide server even when
                the app guards everything behind auth (reporting
                `authenticated: false` requires exactly that). The app's optional
                health hook contributes fields; the framework's identity keys win
                on collision, and a thrown hook is logged and skipped so an app
                bug can't masquerade as an unreachable server. IDENTITY_PATH is
                the compatibility alias for the same payload.
                */
                if (url.pathname === HEALTH_PATH || url.pathname === IDENTITY_PATH) {
                    const payload = await buildHealthPayload(req, { app, appName, appVersion })
                    return gzipResponse(
                        req,
                        Response.json(
                            /*
                            The IDENTITY_PATH alias keeps the legacy `abide: true`
                            shape: already-shipped probers check it with strict
                            equality, and a version string would make them treat
                            an upgraded healthy server as not-abide.
                            */
                            url.pathname === IDENTITY_PATH ? { ...payload, abide: true } : payload,
                            { headers: { 'Cache-Control': NO_STORE } },
                        ),
                    )
                }
                /*
                Inspector surface — answered directly, ahead of app.handle, since
                it's privileged operator tooling gated by ABIDE_ENABLE_INSPECTOR
                (not the app's user auth). Undefined handler = flag off, so the
                whole block compiles out of the hot path when the inspector's off.
                */
                if (
                    inspectorHandler &&
                    (url.pathname === INSPECTOR_PATH ||
                        url.pathname.startsWith(`${INSPECTOR_PATH}/`))
                ) {
                    // The events feed is long-lived SSE: opt it out of the idle
                    // timeout, else Bun reaps it and the reconnect replays the
                    // whole buffer (duplicate boot logs every ~10s).
                    return disableIdleTimeoutForStream(
                        bunServer,
                        req,
                        await inspectorHandler(req, url),
                    )
                }
                /*
                Dev live-reload channel — answered directly, ahead of app.handle,
                so a restart-driven reconnect always lands even when the app guards
                everything behind auth. Only mounted under `abide dev`.
                */
                if (clientFingerprint !== undefined && url.pathname === DEV_RELOAD_PATH) {
                    // Long-lived SSE: opt out of the idle timeout, else Bun reaps
                    // it and the reconnect triggers a spurious reload loop.
                    return disableIdleTimeoutForStream(
                        bunServer,
                        req,
                        devReloadResponse(clientFingerprint),
                    )
                }
                /* Component hot module — the browser imports one edited `.abide`'s
                   hot build here instead of reloading (dev component HMR). */
                if (clientFingerprint !== undefined && url.pathname.startsWith(DEV_HOT_PREFIX)) {
                    /* This endpoint serves `application/javascript` for the browser's
                       `import()`. A TOP-LEVEL NAVIGATION to it — clicking the module link in a
                       stack trace, or opening the URL — would DOWNLOAD the file, since browsers
                       can't render JS as a document. A navigation sends `Accept: text/html`;
                       `import()` sends a wildcard Accept. Redirect a navigation back to a real
                       page (the referring page when same-origin, else the mount root) so the
                       error surfaces in context as a normal render instead of saving a file. */
                    if ((req.headers.get('accept') ?? '').includes('text/html')) {
                        const referer = req.headers.get('referer')
                        const page =
                            referer !== null &&
                            URL.canParse(referer) &&
                            new URL(referer).origin === url.origin &&
                            !new URL(referer).pathname.startsWith(DEV_HOT_PREFIX)
                                ? referer
                                : base || '/'
                        return new Response(null, {
                            status: 302,
                            headers: { Location: page, 'Cache-Control': NO_STORE },
                        })
                    }
                    return devHotModuleResponse(
                        decodeURIComponent(url.pathname.slice(DEV_HOT_PREFIX.length)),
                    )
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
                    return new Response('rebuilding\n', {
                        headers: { 'Content-Type': TEXT_PLAIN },
                    })
                }
                if (url.pathname === SOCKETS_PATH) {
                    // Reject cross-origin upgrades (CSWSH) before handing off to Bun.
                    const upgradeForbidden = crossOriginGate(req, url)
                    if (upgradeForbidden) {
                        return upgradeForbidden
                    }
                    if (bunServer.upgrade(req, { data: {} })) {
                        return undefined as unknown as Response
                    }
                    return new Response('Upgrade failed', {
                        status: 400,
                        headers: { 'Content-Type': TEXT_PLAIN },
                    })
                }
                /*
                HTTP face of a socket (`/__abide/sockets/<name>`) — tail over
                SSE / JSON and publish — for the CLI and MCP. Runs through
                dispatchRequest so app.handle auth applies, like the rpc paths.
                The socket name may contain `/` (nested files), so it's the
                whole remaining pathname, percent-decoded.
                */
                if (url.pathname.startsWith(SOCKETS_REST_PREFIX)) {
                    /*
                    Gate cross-origin browser publishes (CSRF, see crossOriginGate).
                    GET tail reads stay open cross-origin like rpc reads; only
                    the mutating POST is gated.
                    */
                    const publishForbidden = crossOriginGate(req, url, { allowReadOnly: true })
                    if (publishForbidden) {
                        return publishForbidden
                    }
                    const name = decodeURIComponent(url.pathname.slice(SOCKETS_REST_PREFIX.length))
                    return dispatchRequest(
                        req,
                        {},
                        async () => socketDispatcher.rest(req, name),
                        url,
                    )
                }
                if (url.pathname === MCP_PATH && mcp) {
                    // Gate cross-site browser posts (CSRF, see crossOriginGate).
                    const mcpForbidden = crossOriginGate(req, url)
                    if (mcpForbidden) {
                        return mcpForbidden
                    }
                    return dispatchRequest(req, {}, async () => mcp.handle(req), url)
                }
                if (url.pathname === CLI_PATH) {
                    return dispatchRequest(req, {}, async () => handleCliInstall(req, cliName), url)
                }
                if (url.pathname.startsWith(CLI_DOWNLOAD_PREFIX)) {
                    const platform = url.pathname.slice(CLI_DOWNLOAD_PREFIX.length)
                    return dispatchRequest(
                        req,
                        {},
                        async () => handleCliDownload(req, platform, cliName, cliCwd),
                        url,
                    )
                }
                if (url.pathname === OPENAPI_PATH) {
                    return dispatchRequest(
                        req,
                        {},
                        async () => {
                            if (!openApiSpec) {
                                await ensureRegistriesLoaded()
                                openApiSpec = buildOpenApiSpec({
                                    title: appName,
                                    version: appVersion,
                                })
                            }
                            return Response.json(openApiSpec, {
                                headers: { 'Cache-Control': NO_STORE },
                            })
                        },
                        url,
                    )
                }
                /*
                Static assets sidestep ALS + the per-request CacheStore + the
                app.handle middleware: they have no need for cache() and the
                allocation overhead matters on a cold page load that pulls
                dozens of chunks. The global server.error() handler still
                catches anything that goes wrong inside serveAppAsset.
                */
                if (url.pathname.startsWith('/_app/')) {
                    return timedServe(() => serveAppAsset(req, url), req, url)
                }
                /*
                Files under public/ are served at the site root, sidestepping
                ALS + middleware like the /_app/ assets do. A miss returns
                undefined so the request falls through to the 404 / middleware
                path below.
                */
                const publicResponse = await timedServe(() => servePublicAsset(req, url), req, url)
                if (publicResponse) {
                    return publicResponse
                }
                /*
                Unknown routes still run through dispatchRequest so user-defined
                app.handle middleware can rewrite the request, serve a custom
                404, or branch on the URL. The inner handler returns the
                framework's default 404 when nothing intervenes.
                */
                return dispatchRequest(
                    req,
                    {},
                    async (_req, _pathParams, store) => {
                        return (
                            (await renderError(404, 'Not Found', store)) ??
                            new Response('Not Found', {
                                status: 404,
                                headers: { 'Content-Type': TEXT_PLAIN, 'Cache-Control': NO_STORE },
                            })
                        )
                    },
                    url,
                )
            },

            error(err) {
                abideLog.error(err)
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
    Publishes the live server through `abide/server` before invoking the
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
                abideLog.error(err)
            }
        }
        process.exit(0)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)

    /*
    Diagnostic only, and only under `abide` debug logging — eager-loads the
    registry to print the page/socket/rpc surface maps (routing + which
    declarations reach mcp/cli/openapi), making abide's multimodal-by-default
    exposure auditable. Awaited so `ready` lands after all of abide's own
    startup output rather than interleaving with it.
    */
    if (logRequests) {
        await logExposedSurfaces({ pages })
    }
    // Unguarded machine surface check — app.handle is the blessed auth seam.
    if (mcp && !app?.handle) {
        await warnUnguardedMcp()
    }
    abideLog.success(`ready at http://localhost:${server.port}`)
    // Tell the dev orchestrator (when it spawned us with ipc) that boot is
    // complete, so it can retire the previous worker — finishing the
    // zero-downtime swap. No-op on a bare server: process.send is undefined.
    if (dev) {
        process.send?.(DEV_READY_MESSAGE)
    }
    return server
}
