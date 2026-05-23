/*
node:fs — mkdtempSync, realpathSync have no Bun equivalent.
node:os — tmpdir has no Bun equivalent.
*/
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Server } from 'bun'
import { Glob } from 'bun'
import type { Component } from 'svelte'
import { render } from 'svelte/server'
import App from '../../App.svelte'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { isDebugEnabled } from '../shared/isDebugEnabled.ts'
import { log } from '../shared/log.ts'
import { nearestLayoutPrefix } from '../shared/nearestLayoutPrefix.ts'
import type { SocketData } from '../types/App.ts'
import type { AppModule } from '../types/AppModule.ts'
import type { Assets } from '../types/Assets.ts'
import type { HttpVerb } from '../types/HttpVerb.ts'
import type { Layouts } from '../types/Layouts.ts'
import type { Pages } from '../types/Pages.ts'
import type { RemoteRoutes } from '../types/RemoteRoutes.ts'
import type { RequestStore } from '../types/RequestStore.ts'
import type { TraceEntry } from '../types/TraceEntry.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { requestContext } from './requestContext.ts'
import { serializeCacheSnapshot } from './serializeCacheSnapshot.ts'
import { setActiveServer } from './serverSlot.ts'

const MIME: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
}

function contentType(path: string): string {
    const dot = path.lastIndexOf('.')
    if (dot === -1) {
        return 'application/octet-stream'
    }
    return MIME[path.slice(dot)] ?? 'application/octet-stream'
}

function acceptsGzip(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
}

function wantsJson(req: Request): boolean {
    return (req.headers.get('accept') ?? '').includes('application/json')
}

const SOCKET_PATH = '/__belte/socket'
const SSR_CACHE_CONTROL = 'private, no-cache'
const NO_STORE = 'no-store'

function recordTrace(
    store: RequestStore,
    kind: TraceEntry['kind'],
    label: string,
    startNs: number,
): void {
    if (!store.trace) {
        return
    }
    store.trace.push({ kind, label, ms: (Bun.nanoseconds() - startNs) / 1e6 })
}

function formatTrace(entries: Array<TraceEntry>): string {
    let widthKind = 0
    let widthLabel = 0
    for (const entry of entries) {
        if (entry.kind.length > widthKind) {
            widthKind = entry.kind.length
        }
        if (entry.label.length > widthLabel) {
            widthLabel = entry.label.length
        }
    }
    return entries
        .map(
            (entry) =>
                `${entry.kind.padEnd(widthKind)}  ${entry.label.padEnd(widthLabel)}  ${entry.ms.toFixed(2)}ms`,
        )
        .join('\n')
}

const VERBS: HttpVerb[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/*
Starts a Bun HTTP server that ties together the new route conventions:
page.svelte + layout.svelte for views, endpoint.ts for verb-defined handlers,
and an optional app.ts for boot-time setup, request middleware, error fallback,
and socket handlers. Per request, an AsyncLocalStorage RequestStore carries
the cache store, response mutations, and trace ledger.
*/
export async function createServer({
    pages,
    remotes,
    layouts,
    shell,
    app,
    assets,
    distDir = `${process.cwd()}/dist`,
    port = Number(process.env.PORT ?? 3000),
}: {
    pages: Pages
    remotes: RemoteRoutes
    layouts?: Layouts
    shell: string
    app?: AppModule
    assets?: Assets
    distDir?: string
    port?: number
}): Promise<Server<SocketData>> {
    const stubDir = realpathSync(await materializeStubRoutes(pages, remotes))
    const router = new Bun.FileSystemRouter({
        style: 'nextjs',
        dir: stubDir,
        fileExtensions: ['.svelte', '.ts'],
    })

    const stubDirNorm = stubDir.replace(/\/$/, '')
    const pageByFile = new Map<string, string>(
        Object.keys(pages).map((url) => [`${stubDirNorm}${pageStubPath(url)}`, url]),
    )
    const remoteByFile = new Map<string, string>(
        Object.keys(remotes).map((url) => [`${stubDirNorm}${remoteStubPath(url)}`, url]),
    )

    const layoutPrefixes = layouts ? Object.keys(layouts) : []

    const diskGzipPaths = new Set<string>(
        !assets && (await Bun.file(`${distDir}/_app`).exists())
            ? (await Array.fromAsync(new Glob('**/*.gz').scan({ cwd: `${distDir}/_app` }))).map(
                  (file) => `/_app/${file.replace(/\.gz$/, '')}`,
              )
            : [],
    )

    const remoteModuleCache = new Map<
        string,
        Promise<Record<string, ((req: Request) => Promise<Response>) | undefined>>
    >()
    function loadRemote(routeUrl: string) {
        const existing = remoteModuleCache.get(routeUrl)
        if (existing) {
            return existing
        }
        const loader = remotes[routeUrl]
        if (!loader) {
            return undefined
        }
        const promise = loader().then((mod) => {
            const out: Record<string, ((req: Request) => Promise<Response>) | undefined> = {}
            for (const value of Object.values(mod) as Array<unknown>) {
                if (typeof value !== 'function') {
                    continue
                }
                const fn = value as { method?: string; fetch?: (req: Request) => Promise<Response> }
                if (!fn.method || typeof fn.fetch !== 'function') {
                    continue
                }
                if (VERBS.includes(fn.method as HttpVerb)) {
                    out[fn.method] = fn.fetch.bind(fn)
                }
            }
            return out
        })
        remoteModuleCache.set(routeUrl, promise)
        return promise
    }

    const logRequests = isDebugEnabled('belte')
    const tracingEnabled = isDebugEnabled('belte:trace')

    async function serveStaticAsset(req: Request, url: URL): Promise<Response> {
        const mime = contentType(url.pathname)
        const wantsGz = acceptsGzip(req)
        const baseHeaders = {
            'Content-Type': mime,
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
        const start = store.trace ? Bun.nanoseconds() : 0
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
                    layout: Layout,
                    Page,
                    params,
                },
            },
        })
        recordTrace(store, 'render', routeUrl, start)
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

    async function defaultPipeline(req: Request, store: RequestStore): Promise<Response> {
        const url = store.url
        if (url.pathname.startsWith('/_app/')) {
            return serveStaticAsset(req, url)
        }
        const match = router.match(url.pathname)
        if (!match) {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Cache-Control': NO_STORE },
            })
        }
        const params = match.params ?? {}
        const pageUrl = pageByFile.get(match.filePath)
        const remoteUrl = remoteByFile.get(match.filePath)
        const candidate = pageUrl ?? remoteUrl
        if (!candidate) {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Cache-Control': NO_STORE },
            })
        }
        const method = req.method.toUpperCase()
        const hasPage = pages[candidate] !== undefined
        const hasRemote = remotes[candidate] !== undefined
        if (hasRemote) {
            const mod = await loadRemote(candidate)
            const handler = mod?.[method]
            if (handler) {
                const start = store.trace ? Bun.nanoseconds() : 0
                const response = await handler(req)
                recordTrace(store, 'remote', `${method} ${candidate}`, start)
                return response
            }
            if (hasPage && (method === 'GET' || method === 'HEAD')) {
                return renderPage(candidate, params, store)
            }
            const allow = Object.keys(mod ?? {}).filter(
                (key) => (mod as Record<string, unknown>)[key],
            )
            if (hasPage) {
                allow.push('GET', 'HEAD')
            }
            return new Response('Method Not Allowed', {
                status: 405,
                headers: {
                    Allow: Array.from(new Set(allow)).join(', '),
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
            return renderPage(candidate, params, store)
        }
        return new Response('Not Found', {
            status: 404,
            headers: { 'Cache-Control': NO_STORE },
        })
    }

    async function dispatch(req: Request, store: RequestStore): Promise<Response> {
        if (!app?.handle) {
            return defaultPipeline(req, store)
        }
        const start = store.trace ? Bun.nanoseconds() : 0
        const response = await app.handle(req, (next) => defaultPipeline(next, store), {
            server: store.server,
        })
        recordTrace(store, 'middleware', 'handle', start)
        return response
    }

    const baseSocket = app?.socket
    const server = Bun.serve({
        port,
        ...(baseSocket
            ? {
                  websocket: {
                      open: baseSocket.open,
                      message: baseSocket.message,
                      close: baseSocket.close,
                      drain: baseSocket.drain,
                      error: baseSocket.error,
                      ping: baseSocket.ping,
                      pong: baseSocket.pong,
                  },
              }
            : {}),

        async fetch(req, srv) {
            const url = new URL(req.url)
            if (baseSocket && url.pathname === SOCKET_PATH) {
                const upgradeOpts = baseSocket.upgrade
                    ? await baseSocket.upgrade(req, { server: srv })
                    : { data: {} as SocketData }
                if (upgradeOpts === false) {
                    return new Response('Forbidden', { status: 403 })
                }
                if (srv.upgrade(req, upgradeOpts)) {
                    return undefined as unknown as Response
                }
                return new Response('Upgrade failed', { status: 400 })
            }
            const store: RequestStore = {
                url,
                req,
                signal: req.signal,
                cache: createCacheStore(),
                server: srv,
                trace: tracingEnabled ? [] : undefined,
            }
            return requestContext.run(store, async () => {
                const start = logRequests ? Bun.nanoseconds() : 0
                let response: Response
                try {
                    response = await dispatch(req, store)
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
                if (store.trace && store.trace.length > 0) {
                    log.debug('belte:trace', `\n${formatTrace(store.trace)}`)
                }
                return response
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
Escapes characters that could prematurely terminate the surrounding <script>
tag or be interpreted as HTML comment delimiters when a JSON literal is
inlined into an HTML document.
*/
function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/-->/g, '--\\u003e')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
}

function pageStubPath(routeUrl: string): string {
    if (routeUrl === '/') {
        return '/index.svelte'
    }
    return `${routeUrl}.svelte`
}

function remoteStubPath(routeUrl: string): string {
    if (routeUrl === '/') {
        return '/index.ts'
    }
    return `${routeUrl}.ts`
}

/*
filesystem write is unavoidable — Bun.FileSystemRouter requires a real dir on
disk. We materialize one stub `.svelte` per page route and one stub `.ts` per
endpoint route; the runtime maps matched filenames back to original route URLs.
When a page and an endpoint share the same URL, only the page stub is written —
the dispatch logic falls back to the endpoint when the page exists for GET/HEAD
and the endpoint covers POST/PUT/PATCH/DELETE.
*/
async function materializeStubRoutes(pages: Pages, remotes: RemoteRoutes): Promise<string> {
    const dir = mkdtempSync(`${tmpdir()}/belte-routes-`)
    const writes: Array<Promise<unknown>> = []
    for (const url of Object.keys(pages)) {
        writes.push(Bun.write(`${dir}${pageStubPath(url)}`, ''))
    }
    for (const url of Object.keys(remotes)) {
        if (!pages[url]) {
            writes.push(Bun.write(`${dir}${remoteStubPath(url)}`, ''))
        }
    }
    await Promise.all(writes)
    return dir
}
