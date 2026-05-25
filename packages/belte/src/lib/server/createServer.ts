import type { BunRequest, Server } from 'bun'
import { Glob } from 'bun'
import type { Component } from 'svelte'
import { render } from 'svelte/server'
import App from '../../App.svelte'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { isDebugEnabled } from '../shared/isDebugEnabled.ts'
import { log } from '../shared/log.ts'
import { nearestLayoutPrefix } from '../shared/nearestLayoutPrefix.ts'
import { toBunRoutePattern } from '../shared/toBunRoutePattern.ts'
import type { AppModule } from '../types/AppModule.ts'
import type { Assets } from '../types/Assets.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { Layouts } from '../types/Layouts.ts'
import type { Pages } from '../types/Pages.ts'
import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteRoutes } from '../types/RemoteRoutes.ts'
import type { RequestStore } from '../types/RequestStore.ts'
import type { SocketRoutes } from '../types/SocketRoutes.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { createSocketRpcDispatcher } from './createSocketRpcDispatcher.ts'
import { requestContext } from './requestContext.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import { setActiveServer } from './serverSlot.ts'

function acceptsGzip(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
}

function wantsJson(req: Request): boolean {
    return (req.headers.get('accept') ?? '').includes('application/json')
}

const SOCKET_PATH = '/__belte/socket'
const SSR_CACHE_CONTROL = 'private, no-cache'
const NO_STORE = 'no-store'

type AnyRemoteFunction = RemoteFunction<unknown, unknown>

/*
Starts a Bun HTTP server that ties together the route conventions:
page.svelte + layout.svelte under src/pages/ for views, one named export
per file under src/rpc/ for verb-bound remote functions, and an optional
app.ts for boot-time setup, request middleware, error fallback, and socket
handlers. Pages and rpc URLs live in disjoint spaces — pages mount at the
folder path, rpc files mount at `/rpc/<file path>` — so each registered
URL resolves to exactly one thing. Per request, an AsyncLocalStorage
RequestStore carries the cache store and request metadata.
*/
export async function createServer({
    pages,
    rpc,
    sockets,
    layouts,
    shell,
    app,
    assets,
    distDir = `${process.cwd()}/dist`,
    port = Number(process.env.PORT ?? 3000),
}: {
    pages: Pages
    rpc: RemoteRoutes
    sockets: SocketRoutes
    layouts?: Layouts
    shell: string
    app?: AppModule
    assets?: Assets
    distDir?: string
    port?: number
}): Promise<Server<unknown>> {
    /*
    Forward-declared so the per-request closures below can reference it. The
    value is assigned by Bun.serve() further down; closures only fire after
    that, so the read-before-write is safe at runtime.
    */
    let server!: Server<unknown>
    const layoutPrefixes = layouts ? Object.keys(layouts) : []

    const diskGzipPaths = new Set<string>(
        !assets && (await Bun.file(`${distDir}/_app`).exists())
            ? (await Array.fromAsync(new Glob('**/*.gz').scan({ cwd: `${distDir}/_app` }))).map(
                  (file) => `/_app/${file.replace(/\.gz$/, '')}`,
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
        const wantsGz = acceptsGzip(req)
        const contentType = mimeForExtension(url.pathname)
        const baseHeaders = {
            'Content-Type': contentType,
            Vary: 'Accept-Encoding',
            'Cache-Control': cacheControlForAsset(url.pathname),
        }
        const gzipHeaders = { ...baseHeaders, 'Content-Encoding': 'gzip' }
        if (assets) {
            const gzipped = assets[url.pathname]
            if (!gzipped) {
                return new Response('Not Found', {
                    status: 404,
                    headers: { 'Cache-Control': NO_STORE },
                })
            }
            if (wantsGz) {
                return new Response(gzipped, { headers: gzipHeaders })
            }
            return new Response(Bun.gunzipSync(gzipped), { headers: baseHeaders })
        }
        const diskPath = distDir + url.pathname
        if (wantsGz && diskGzipPaths.has(url.pathname)) {
            return new Response(Bun.file(`${diskPath}.gz`), { headers: gzipHeaders })
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
    $rpc URLs are flat). Page URLs (under src/pages/) serve GET/HEAD by
    rendering; rpc URLs (under src/rpc/, prefixed with `/rpc/`) dispatch
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
    Belte's only native WebSocket surface is SOCKET-bound rpc: all sockets
    multiplex onto one framework-owned connection per client at
    /__belte/socket. The dispatcher owns the open/message/close handlers
    below; user code never sees the raw ws lifecycle.
    */
    const rpcDispatcher = createSocketRpcDispatcher(sockets)
    server = Bun.serve({
        port,

        websocket: {
            open(ws) {
                rpcDispatcher.open(ws)
            },
            message(ws, data) {
                rpcDispatcher.message(ws, data)
            },
            close(ws) {
                rpcDispatcher.close(ws)
            },
        },

        routes,

        async fetch(req, srv) {
            const url = new URL(req.url)
            if (url.pathname === SOCKET_PATH) {
                if (srv.upgrade(req, { data: {} })) {
                    return undefined as unknown as Response
                }
                return new Response('Upgrade failed', { status: 400 })
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
    user's init() hook. The exported `server` is a Proxy that throws on any
    access before this slot is set, so init() callers can hold a stable
    reference at module scope and still see the real instance once boot
    completes.
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

/*
Inspects the raw request URL (not the parsed pathname) for path-traversal
patterns. The WHATWG URL parser decodes `%2E%2E` to `..` and then collapses
dot-segments out of the pathname during normalization, so by the time
`url.pathname` is observable any encoded traversal has been masked. The
remaining literal `..` check guards against any future URL-parser quirk
that lets a normalised path through.
*/
function containsTraversal(rawUrl: string): boolean {
    if (rawUrl.includes('\\')) {
        return true
    }
    const lower = rawUrl.toLowerCase()
    if (lower.includes('%2e%2e') || lower.includes('%2f') || lower.includes('%5c')) {
        return true
    }
    const queryStart = rawUrl.indexOf('?')
    const pathEnd = queryStart === -1 ? rawUrl.length : queryStart
    const pathStart = rawUrl.indexOf('/', rawUrl.indexOf('://') + 3)
    if (pathStart === -1 || pathStart >= pathEnd) {
        return false
    }
    return rawUrl
        .slice(pathStart, pathEnd)
        .split('/')
        .some((segment) => segment === '..')
}

/*
Derives the MIME type from a URL pathname using Bun.file().type, which
operates on the file extension synchronously without touching the disk. The
Bun.file ref here is never read from — it exists only to reuse Bun's
extension-to-MIME table.
*/
function mimeForExtension(pathname: string): string {
    return Bun.file(pathname).type
}

/*
Escapes characters that could prematurely terminate the surrounding <script>
tag or be interpreted as HTML comment delimiters when a JSON literal is
inlined into an HTML document.
*/
const LINE_TERMINATORS = /[\u2028\u2029]/g

function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/-->/g, '--\\u003e')
        .replace(LINE_TERMINATORS, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'))
}
