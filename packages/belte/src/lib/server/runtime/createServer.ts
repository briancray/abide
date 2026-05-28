import type { BunRequest, Server } from 'bun'
import { Glob } from 'bun'
import type { Component } from 'svelte'
import { render } from 'svelte/server'
import App from '../../../App.svelte'
import type { Layouts } from '../../browser/types/Layouts.ts'
import type { Pages } from '../../browser/types/Pages.ts'
import { createMcpResourceServer } from '../../mcp/createMcpResourceServer.ts'
import { setMcpResourceServer } from '../../mcp/mcpResourceServerSlot.ts'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { NO_STORE, SSR_CACHE_CONTROL } from '../../shared/cacheControlValues.ts'
import { createCacheStore } from '../../shared/createCacheStore.ts'
import { isDebugEnabled } from '../../shared/isDebugEnabled.ts'
import { log } from '../../shared/log.ts'
import { nearestLayoutPrefix, normalizeLayoutPrefixes } from '../../shared/nearestLayoutPrefix.ts'
import { toBunRoutePattern } from '../../shared/toBunRoutePattern.ts'
import type { AppModule } from '../AppModule.ts'
import { handleCliDownload } from '../cli/handleCliDownload.ts'
import { handleCliInstall } from '../cli/handleCliInstall.ts'
import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { HttpVerb } from '../rpc/types/HttpVerb.ts'
import type { RemoteFunction } from '../rpc/types/RemoteFunction.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'
import { buildOpenApiSpec } from './buildOpenApiSpec.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { containsTraversal } from './containsTraversal.ts'
import { createPublicAssetServer } from './createPublicAssetServer.ts'
import { mimeForExtension } from './mimeForExtension.ts'
import { ensureRegistriesLoaded, setRegistryManifests } from './registryManifests.ts'
import { requestContext } from './requestContext.ts'
import { safeJsonForScript } from './safeJsonForScript.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import { setActiveServer } from './setActiveServer.ts'
import type { Assets } from './types/Assets.ts'
import type { RequestStore } from './types/RequestStore.ts'

function acceptsZstd(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('zstd')
}

function wantsJson(req: Request): boolean {
    return (req.headers.get('accept') ?? '').includes('application/json')
}

const SOCKETS_PATH = '/__belte/sockets'
const MCP_PATH = '/__belte/mcp'
const CLI_PATH = '/__belte/cli'
const CLI_DOWNLOAD_PREFIX = '/__belte/cli/'
const OPENAPI_PATH = '/openapi.json'

type AnyRemoteFunction = RemoteFunction<unknown, unknown>

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
    port = Number(process.env.PORT ?? 3000),
}: {
    pages: Pages
    rpc: RemoteRoutes
    sockets: SocketRoutes
    prompts: PromptRoutes
    layouts?: Layouts
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
}): Promise<Server<unknown>> {
    setRegistryManifests({ rpc, sockets, prompts })
    setMcpResourceServer(createMcpResourceServer({ resourcesDir, mcpResources }))
    const cliName = cliProgramName ?? 'app'
    const cliCwd = process.cwd()
    const servePublicAsset = createPublicAssetServer({ publicDir, publicAssets })
    /*
    Forward-declared so the per-request closures below can reference it. The
    value is assigned by Bun.serve() further down; closures only fire after
    that, so the read-before-write is safe at runtime.
    */
    let server!: Server<unknown>
    const layoutPrefixes = layouts ? normalizeLayoutPrefixes(Object.keys(layouts)) : []

    const diskZstdPaths = new Set<string>(
        !assets && (await Bun.file(`${distDir}/_app`).exists())
            ? (await Array.fromAsync(new Glob('**/*.zst').scan({ cwd: `${distDir}/_app` }))).map(
                  (file) => `/_app/${file.replace(/\.zst$/, '')}`,
              )
            : [],
    )

    const rpcModuleCache = new Map<string, Promise<AnyRemoteFunction | undefined>>()
    function loadRpc(url: string): Promise<AnyRemoteFunction | undefined> | undefined {
        const existing = rpcModuleCache.get(url)
        if (existing) {
            return existing
        }
        const loader = rpc[url]
        if (!loader) {
            return undefined
        }
        /*
        Each $rpc module has exactly one named export, validated at build
        time. Pick the first export that looks like a RemoteFunction so the
        framework stays tolerant of incidental re-exports.
        */
        const promise = loader().then((mod) => {
            for (const value of Object.values(mod)) {
                if (typeof value === 'function' && 'method' in value && 'url' in value) {
                    return value as AnyRemoteFunction
                }
            }
            return undefined
        })
        rpcModuleCache.set(url, promise)
        return promise
    }

    const logRequests = isDebugEnabled('belte')

    /*
    Header objects for a pathname depend only on the pathname's extension
    and the immutable HASHED test. Cache them so repeat hits on the same
    chunk reuse a single frozen header bag instead of allocating per
    request.
    */
    type AssetHeaderBundle = {
        base: HeadersInit
        zstd: HeadersInit
    }
    const assetHeaderCache = new Map<string, AssetHeaderBundle>()
    function headersForAsset(pathname: string): AssetHeaderBundle {
        const cached = assetHeaderCache.get(pathname)
        if (cached) {
            return cached
        }
        const base: HeadersInit = {
            'Content-Type': mimeForExtension(pathname),
            Vary: 'Accept-Encoding',
            'Cache-Control': cacheControlForAsset(pathname),
        }
        const zstd: HeadersInit = { ...base, 'Content-Encoding': 'zstd' }
        const bundle = { base, zstd }
        assetHeaderCache.set(pathname, bundle)
        return bundle
    }

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
            return new Response(Bun.zstdDecompressSync(compressed), { headers: baseHeaders })
        }
        const diskPath = distDir + url.pathname
        if (wantsZstd && diskZstdPaths.has(url.pathname)) {
            return new Response(Bun.file(`${diskPath}.zst`), { headers: zstdHeaders })
        }
        return new Response(Bun.file(diskPath), { headers: baseHeaders })
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
        const cacheSnapshot = await serializeCacheSnapshot(store.cache)
        const stateTag = `<script>window.__SSR__ = ${safeJsonForScript({
            route: routeUrl,
            params,
            cache: cacheSnapshot,
        })};</script>`
        const html = shell
            .replace('<!--ssr:head-->', rendered.head)
            .replace('<!--ssr:body-->', rendered.body)
            .replace('<!--ssr:state-->', stateTag)
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                Vary: 'Accept',
                'Cache-Control': SSR_CACHE_CONTROL,
            },
        })
    }

    /*
    Per-route handler bound by buildRoutes(). Receives a BunRequest with
    `params` filled from the route pattern (only pages use path params;
    $rpc URLs are flat). Page URLs (under src/browser/pages/) serve GET/HEAD by
    rendering; rpc URLs (under src/server/rpc/, prefixed with `/rpc/`) dispatch
    to the single declared verb-bound handler. URLs are disjoint by
    construction so each path goes to exactly one branch.
    */
    function buildRouteHandler(routeUrl: string) {
        const hasPage = pages[routeUrl] !== undefined
        const hasRpc = rpc[routeUrl] !== undefined
        return async function routeHandler(
            req: Request,
            pathParams: Record<string, string>,
            store: RequestStore,
        ): Promise<Response> {
            const method = req.method as HttpVerb
            if (hasRpc) {
                const fn = await loadRpc(routeUrl)
                if (fn && fn.method === method) {
                    return fn.fetch(req)
                }
                const allow = fn ? fn.method : ''
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: {
                        Allow: allow,
                        'Cache-Control': NO_STORE,
                    },
                })
            }
            if (hasPage) {
                if (method !== 'GET' && method !== 'HEAD') {
                    return new Response('Method Not Allowed', {
                        status: 405,
                        headers: { Allow: 'GET, HEAD', 'Cache-Control': NO_STORE },
                    })
                }
                return renderPage(routeUrl, pathParams, store)
            }
            return new Response('Not Found', {
                status: 404,
                headers: { 'Cache-Control': NO_STORE },
            })
        }
    }

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
        return runWithStore(req, async (store) => {
            if (!app?.handle) {
                return handler(req, pathParams, store)
            }
            return app.handle(req, (next) => handler(next, pathParams, store))
        })
    }

    function runWithStore(
        req: Request,
        body: (store: RequestStore) => Promise<Response>,
    ): Promise<Response> {
        const url = new URL(req.url)
        const store: RequestStore = {
            url,
            req,
            signal: req.signal,
            cache: createCacheStore(),
            server,
        }
        return requestContext.run(store, async () => {
            const start = logRequests ? Bun.nanoseconds() : 0
            let response: Response
            try {
                response = await body(store)
            } catch (error) {
                if (app?.handleError) {
                    response = await app.handleError(error, req)
                } else {
                    log.error(error)
                    response = new Response(
                        `<pre>${String((error as Error)?.stack ?? error)}</pre>`,
                        {
                            status: 500,
                            headers: {
                                'Content-Type': 'text/html; charset=utf-8',
                                'Cache-Control': NO_STORE,
                            },
                        },
                    )
                }
            }
            if (logRequests) {
                const ms = (Bun.nanoseconds() - start) / 1e6
                log.request(req.method, `${url.pathname}${url.search}`, response.status, ms)
            }
            return response
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
    server = Bun.serve({
        port,

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
            if (url.pathname === SOCKETS_PATH) {
                if (bunServer.upgrade(req, { data: {} })) {
                    return undefined as unknown as Response
                }
                return new Response('Upgrade failed', { status: 400 })
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
            return dispatchRequest(req, {}, async () => {
                return new Response('Not Found', {
                    status: 404,
                    headers: { 'Cache-Control': NO_STORE },
                })
            })
        },

        error(err) {
            log.error(err)
            return new Response(`<pre>${String(err.stack ?? err)}</pre>`, {
                status: 500,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': NO_STORE,
                },
            })
        },
    })

    /*
    Publishes the live server through `belte/server` before invoking the
    user's init() hook. The exported `server()` function reads from this
    slot and throws on access before the slot is set, so init() callers
    can hold the import at module scope and still see the real instance
    once boot completes.
    */
    setActiveServer(server)

    if (app?.init) {
        const cleanup = await app.init({ server })
        if (typeof cleanup === 'function') {
            const shutdown = async () => {
                try {
                    await cleanup()
                } catch (err) {
                    log.error(err)
                }
                process.exit(0)
            }
            process.once('SIGINT', shutdown)
            process.once('SIGTERM', shutdown)
        }
    }

    log.success(`ready at http://localhost:${server.port}`)
    return server
}
