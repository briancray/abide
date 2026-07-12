import type { Server } from 'bun'
import { createMcpResourceServer } from '../../mcp/createMcpResourceServer.ts'
import { mcpResourceServerSlot } from '../../mcp/mcpResourceServerSlot.ts'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { abideLog } from '../../shared/abideLog.ts'
import { basePathFromAppUrl } from '../../shared/basePathFromAppUrl.ts'
import { baseSlot } from '../../shared/baseSlot.ts'
import { CACHE_STALENESS_SOCKET } from '../../shared/CACHE_STALENESS_SOCKET.ts'
import { extraForwardHeaders } from '../../shared/extraForwardHeaders.ts'
import { healthReadSlot } from '../../shared/healthReadSlot.ts'
import { isDebugNegated } from '../../shared/isDebugNegated.ts'
import { logClosingRecord } from '../../shared/logClosingRecord.ts'
import { OFFLINE_HEADER } from '../../shared/OFFLINE_HEADER.ts'
import { parseBoundedEnvInt } from '../../shared/parseBoundedEnvInt.ts'
import { RESERVED_SOCKET_PREFIX } from '../../shared/RESERVED_SOCKET_PREFIX.ts'
import { requestScopeSlot } from '../../shared/requestScopeSlot.ts'
import { setAppName } from '../../shared/setAppName.ts'
import type { Layouts } from '../../ui/types/Layouts.ts'
import type { Pages } from '../../ui/types/Pages.ts'
import type { AppModule } from '../AppModule.ts'
import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import { defineSocket } from '../sockets/defineSocket.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'
import { buildHealthPayload } from './buildHealthPayload.ts'
import { buildOpenApiSpec } from './buildOpenApiSpec.ts'
import { buildPreloadManifest } from './buildPreloadManifest.ts'
import { createAppAssetServer } from './createAppAssetServer.ts'
import { createAppRouteResolver } from './createAppRouteResolver.ts'
import { createPlumbingRouter, PLUMBING_PASS } from './createPlumbingRouter.ts'
import { createPublicAssetServer } from './createPublicAssetServer.ts'
import { createRouteDispatcher } from './createRouteDispatcher.ts'
import { createUiPageRenderer } from './createUiPageRenderer.ts'
import { DEFAULT_PORT } from './DEFAULT_PORT.ts'
import { DEV_READY_MESSAGE } from './DEV_READY_MESSAGE.ts'
import { DEV_RELOAD_CLIENT_SCRIPT } from './DEV_RELOAD_CLIENT_SCRIPT.ts'
import { devClientFingerprint } from './devClientFingerprint.ts'
import { finalizeResponse } from './finalizeResponse.ts'
import { installAmbientScopeStore } from './installAmbientScopeStore.ts'
import { internalErrorResponse } from './internalErrorResponse.ts'
import { listenOnOpenPort } from './listenOnOpenPort.ts'
import { logExposedSurfaces } from './logExposedSurfaces.ts'
import { maybeMountInspector } from './maybeMountInspector.ts'
import { pageRenderSlot } from './pageRenderSlot.ts'
import { parseIdleTimeout } from './parseIdleTimeout.ts'
import { parsePort } from './parsePort.ts'
import { ensureRegistriesLoaded, setRegistryManifests } from './registryManifests.ts'
import { requestContext } from './requestContext.ts'
import { runWithRequestScope } from './runWithRequestScope.ts'
import { setActiveServer } from './setActiveServer.ts'
import { textResponse } from './textResponse.ts'
import type { Assets } from './types/Assets.ts'
import type { RequestStore } from './types/RequestStore.ts'
import { warnUnguardedMcp } from './warnUnguardedMcp.ts'

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
    /*
    Key the ambient lexical scope off the per-request ALS store, so concurrent
    async SSR renders don't clobber one shared module global across the inline
    `await`s they suspend on (see installAmbientScopeStore / CURRENT_SCOPE).
    */
    installAmbientScopeStore()
    requestScopeSlot.resolver = () => {
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
    }
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
    /*
    Mount base from APP_URL's pathname (e.g. https://foo.com/v2 → /v2). Install
    the server-side resolver so url() prefixes SSR-generated links, and rewrite
    the shell's framework `/_app` entry + css refs to carry the base — relative
    code-split chunks inherit it from the entry's own URL. '' (root mount) is a
    no-op on both. See seedBootState / startClient for the client half.
    */
    const base = basePathFromAppUrl(process.env.APP_URL)
    baseSlot.resolver = () => base
    // Rebase the shell's rooted `/_app/` entry refs onto the mount base, matching
    // either quote style so a custom app.html using single quotes still rewrites.
    const activeShell = base ? devShell.replace(/(["'])\/_app\//g, `$1${base}/_app/`) : devShell
    /*
    The physical dir the `/_app/*` URLs map onto. Production reads the stable
    `dist/_app`; under `abide dev` the orchestrator serves each build generation from
    its own `_app.gen-<id>` dir and passes it as ABIDE_APP_DIR, so this worker serves
    exactly the generation it was spawned on. A rebuild's replacement worker gets a
    fresh dir while this one keeps reading its own, immutable for its lifetime — which
    is why a retiring worker never 500s on chunks a rebuild would otherwise have
    deleted. Must match the dir abideResolverPlugin rewrote the shell's entry ref from.
    */
    const appDir = process.env.ABIDE_APP_DIR ?? `${distDir}/_app`
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
        createAppAssetServer({ appDir, assets }),
        buildPreloadManifest({ appDir, assets }),
    ])
    /*
    Diagnostic (DEBUG=abide:dev): one line recording what this worker actually serves —
    its generation dir and the hashed client entry the shell points at. Pinning makes a
    shell⇄disk mismatch structurally impossible (the entry always lives in appDir), so
    this is confirmation/defense-in-depth, not a routine line: it stays off by default.
    Dev only — an embedded standalone build has no on-disk generation dir.
    */
    if (dev && !assets) {
        const entryRef = activeShell.match(/\/_app\/(client-[a-z0-9]+\.js)/i)?.[1] ?? 'client.js'
        abideLog.channel('abide:dev')(`serving ${appDir.split('/').pop()} · entry ${entryRef}`)
    }
    setRegistryManifests({ rpc, sockets, prompts })
    mcpResourceServerSlot.server = createMcpResourceServer({ resourcesDir, mcpResources })
    const cliName = cliProgramName ?? 'app'
    /* The app's public identity, shared by the identity probe and the OpenAPI spec. */
    const appName = appInfo?.name ?? cliName
    const appVersion = appInfo?.version ?? '0.0.0'
    /* The app's default log channel — every unchanneled record speaks as [appName]. */
    setAppName(appName)
    /* The single health-payload builder, bound to this app's identity — shared by the
       /__abide/health probe and the renderer's __SSR__ seed so the wire and seed can't drift. */
    const healthPayloadFor = (request: Request) =>
        buildHealthPayload(request, { app, appName, appVersion })
    /*
    Opt-in inspector (ABIDE_ENABLE_INSPECTOR=true): a dynamically-imported
    `@abide/inspector` handler, or undefined when the flag is off / the package
    isn't installed. Resolved at boot so the fetch route below can branch on it.
    */
    const inspectorHandler = await maybeMountInspector({ name: appName, version: appVersion })
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
        healthPayload: healthPayloadFor,
    })

    /*
    Route dispatch — rpc-vs-page-vs-404 resolution and method matching — lives
    behind createRouteDispatcher; renderPage is injected so those decisions stay
    testable without SSR. The fetch handler resolves a request URL to a handler
    through the shared matchRoute — the same matcher the client router runs —
    so params decode and route precedence agree across the sides by
    construction (no Bun routes table with its own pattern semantics).
    */
    const buildRouteHandler = createRouteDispatcher({ pages, rpc, renderPage })

    /*
    URL-shape resolution — canonical-slash 308s, the openapi doc's build + memo,
    and asset precedence (page routes shadow same-path public files; `/_app/`
    before public/) — lives behind createAppRouteResolver. It composes the
    dispatcher's per-URL handlers and returns a data-only decision the fetch
    closure wires to its effect (ALS dispatch, asset serve, 404 render), so those
    URL-shape decisions stay testable without booting Bun.serve. The openapi doc
    is built from the frozen rpc registry, memoised across concurrent cold
    requests, and cleared on a failed build so a later request retries.
    */
    const resolveAppRoute = createAppRouteResolver({
        pages,
        rpc,
        buildRouteHandler,
        openApiPath: OPENAPI_PATH,
        buildOpenApiDocument: () =>
            ensureRegistriesLoaded().then(() =>
                buildOpenApiSpec({ title: appName, version: appVersion }),
            ),
    })

    function dispatchRequest(
        req: Request,
        pathParams: Record<string, string>,
        handler: (
            req: Request,
            pathParams: Record<string, string>,
            store: RequestStore,
        ) => Promise<Response>,
        url: URL,
    ): Promise<Response> {
        return runWithRequestScope(req, { app, logRequests, url }, async (store) => {
            const response = app?.handle
                ? await app.handle(req, (next) => handler(next, pathParams, store))
                : await handler(req, pathParams, store)
            /* Wire handling — classify once, mark the stream monitor, exempt
               streams from the idle timeout, gzip — lives in finalizeResponse. */
            return finalizeResponse(req, response, store, () => server.timeout(req, 0))
        })
    }

    /*
    Publish the in-process page-render seam for the public `render()`. It resolves
    a synthetic GET request the same way the fetch handler resolves live app routes
    (matchRoute → page handler / 308 redirect), then runs the matched handler
    directly under runWithRequestScope — the page analogue of dispatchRpcInProcess,
    so it skips app.handle middleware and wire finalization (gzip) exactly as the
    in-process rpc seam does. A URL that resolves to no page renders the framework
    404, matching the fetch fallback.
    */
    pageRenderSlot.render = (request, url) => {
        const resolution = resolveAppRoute(request, url)
        if (resolution.kind === 'redirect') {
            return Promise.resolve(resolution.response)
        }
        if (resolution.kind === 'handler') {
            return runWithRequestScope(request, { app, logRequests: false, url }, (store) =>
                resolution.handler(request, resolution.params, store),
            )
        }
        return runWithRequestScope(request, { app, logRequests: false, url }, async (store) => {
            return (await renderError(404, 'Not Found', store)) ?? textResponse(404)
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
    /* Reserve the `__abide/` socket namespace: a user socket file whose name lands there
       would shadow a framework-minted internal topic (the cache-staleness pipe below), so
       fail the boot loudly rather than let it silently override. */
    for (const name of Object.keys(sockets)) {
        if (name.startsWith(RESERVED_SOCKET_PREFIX)) {
            throw new Error(
                `[abide] socket name "${name}" is reserved — the "${RESERVED_SOCKET_PREFIX}" namespace is framework-internal. Rename the file under src/server/sockets.`,
            )
        }
    }
    /* Mint the reserved cache-staleness topic (ADR-0041): server-publish-only, no retention
       tail (a pure live pipe). defineSocket registers it in socketRegistry, where the
       broadcaster and the dispatcher's reserved-name path both resolve it. */
    defineSocket(CACHE_STALENESS_SOCKET, { tail: 0, clientPublish: false })

    const socketDispatcher = createSocketDispatcher(sockets)

    /*
    Framework HTTP surface — the health/identity probe, inspector, dev
    channels, sockets upgrade + REST face, MCP, and CLI — resolved ahead of the
    app's rpc/page routes. Returns PLUMBING_PASS for any path it doesn't own so
    the fetch handler falls through to the app routes below.
    */
    const routePlumbing = createPlumbingRouter({
        dev,
        clientFingerprint,
        inspectorHandler,
        socketDispatcher,
        mcp,
        cliName,
        cliCwd,
        healthPayload: healthPayloadFor,
        dispatchRequest,
    })

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

            async fetch(req, bunServer) {
                const url = new URL(req.url)
                /*
                Framework HTTP surface — the health/identity probe, inspector,
                the dev live-reload/rebuild channels, the sockets
                upgrade and its SSE/JSON face, MCP, and CLI — resolved ahead of
                the app's rpc/page routes (see createPlumbingRouter). Each answers
                either directly (ahead of app.handle) or through dispatchRequest,
                exactly as before. PLUMBING_PASS means the path is none of them, so
                fall through to the app routes below.
                */
                const plumbed = routePlumbing(req, url, bunServer)
                if (plumbed !== PLUMBING_PASS) {
                    return plumbed
                }
                /*
                App routes — the rpc-vs-page-vs-308-vs-asset URL-shape decision
                lives behind createAppRouteResolver, resolved AFTER the `/__abide/*`
                plumbing above (a reserved namespace no app route occupies). It
                returns a data-only decision; the closure below is the thin wiring
                that applies each to its effect.
                */
                const resolution = resolveAppRoute(req, url)
                if (resolution.kind === 'handler') {
                    return dispatchRequest(req, resolution.params, resolution.handler, url)
                }
                if (resolution.kind === 'redirect') {
                    return resolution.response
                }
                /*
                Static assets sidestep ALS + the per-request CacheStore + the
                app.handle middleware: they have no need for cache() and the
                allocation overhead matters on a cold page load that pulls
                dozens of chunks. The global server.error() handler still
                catches anything that goes wrong inside serveAppAsset.
                */
                if (resolution.kind === 'appAsset') {
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
                        return (await renderError(404, 'Not Found', store)) ?? textResponse(404)
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

    abideLog.success(`ready at http://localhost:${server.port}`)
    // Tell the dev orchestrator (when it spawned us with ipc) that boot is
    // complete, so it can retire the previous worker — finishing the
    // zero-downtime swap. No-op on a bare server: process.send is undefined.
    if (dev) {
        process.send?.(DEV_READY_MESSAGE)
    }
    /* Unguarded machine surface check — app.handle is the blessed auth seam. Runs AFTER ready
       like the surface map below: warnUnguardedMcp eager-loads the registry (building the rpc
       ts.Program via the onLoad transform), so leaving it pre-ready would re-block boot for an
       unguarded-MCP app. Guarded so the warning can't fell a now-ready worker. */
    if (mcp && !app?.handle) {
        try {
            await warnUnguardedMcp()
        } catch (error) {
            abideLog.error(error)
        }
    }
    /*
    Diagnostic surface map (on by default via `logRequests`; opt out with DEBUG=-abide):
    eager-loads the registry to
    print the page/socket/rpc surface (routing + which declarations reach mcp/cli/openapi),
    making abide's multimodal-by-default exposure auditable. It runs AFTER the ready signal
    because that eager load imports every rpc/socket module — which builds the rpc ts.Program
    via the onLoad transform — ~1.4s that used to block readiness on EVERY dev worker boot.
    The server is already listening, so printing it now costs nothing off time-to-ready, and
    the registry (and its program) stays lazy on the reload hot path. In dev only the first
    worker prints it (ABIDE_DEV_SURFACE, set by the orchestrator) — a respawn's surface is
    identical. Guarded: a diagnostic failure must never fell a now-ready worker.
    */
    if (logRequests && (!dev || process.env.ABIDE_DEV_SURFACE === '1')) {
        try {
            await logExposedSurfaces({ pages })
        } catch (error) {
            abideLog.error(error)
        }
    }
    return server
}
