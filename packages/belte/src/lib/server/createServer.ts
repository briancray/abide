/*
node:fs — mkdtempSync, realpathSync have no Bun equivalent.
node:os — tmpdir has no Bun equivalent.
*/
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Server, WebSocketHandler } from 'bun'
import { Glob } from 'bun'
import type { Component } from 'svelte'
import { render } from 'svelte/server'
import App from '../../App.svelte'
import { isDebugEnabled } from '../shared/isDebugEnabled.ts'
import { layoutLoadersFor } from '../shared/layoutLoadersFor.ts'
import { log } from '../shared/log.ts'
import type { ApiHandler } from '../types/ApiHandler.ts'
import type { ApiModule } from '../types/ApiModule.ts'
import type { ApiRoutes } from '../types/ApiRoutes.ts'
import type { Assets } from '../types/Assets.ts'
import type { LayoutDataModule } from '../types/LayoutDataModule.ts'
import type { Layouts } from '../types/Layouts.ts'
import type { RequestStore } from '../types/RequestStore.ts'
import type { ResolveContext } from '../types/ResolveContext.ts'
import type { Routes } from '../types/Routes.ts'
import type { SocketUpgrade } from '../types/SocketUpgrade.ts'
import type { TraceEntry } from '../types/TraceEntry.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { requestContext } from './requestContext.ts'

function acceptsGzip(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
}

// Client-side nav fetches resolve data via the same handler with Accept: application/json.
function wantsJson(req: Request): boolean {
    return (req.headers.get('accept') ?? '').includes('application/json')
}

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

/*
Headers forwarded automatically from the inbound request onto any
path-relative subrequest. Skipped when the caller has already set the
header explicitly. cookie/authorization make SSR fetches inherit the
user's session; the x-forwarded-* trio preserves proxy chain context.
*/
const FORWARDED_HEADERS = [
    'cookie',
    'authorization',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-host',
]

// global fetch patch is the intended side effect — user code calls plain `fetch`
let fetchPatched = false

function rawUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
        return input
    }
    if (input instanceof URL) {
        return input.href
    }
    if (input instanceof Request) {
        return input.url
    }
    return String(input)
}

/*
Builds the outbound Request for a path-relative subrequest: resolves the
URL against the inbound origin, copies the user's body/method/headers,
forwards session-shaped headers from the inbound request when not already
set, and merges the inbound abort signal so client disconnects cancel
in-flight subrequests.
*/
function buildForwardedRequest(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    resolvedUrl: URL,
    store: RequestStore,
): Request {
    const base =
        input instanceof Request ? new Request(resolvedUrl, input) : new Request(resolvedUrl, init)
    const headers = new Headers(base.headers)
    FORWARDED_HEADERS.forEach((name) => {
        if (headers.has(name)) {
            return
        }
        const value = store.req.headers.get(name)
        if (value) {
            headers.set(name, value)
        }
    })
    const signal = base.signal ? AbortSignal.any([base.signal, store.signal]) : store.signal
    return new Request(base, { headers, signal })
}

/*
Monkey-patches globalThis.fetch so user code can call `fetch('/foo')` during
SSR and have it resolve against the incoming request's origin. Additionally:
forwards cookie/auth headers, propagates the inbound abort signal, single-
flights duplicate GET/HEAD calls, and short-circuits to colocated api
handlers without going through the HTTP stack. Idempotent — only applies once.
*/
function patchFetch(): void {
    if (fetchPatched) {
        return
    }
    fetchPatched = true
    const baseFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const raw = rawUrl(input)
        // "/foo" is path-relative (resolve against the request); "//host" is protocol-relative (leave alone).
        if (!raw.startsWith('/') || raw.startsWith('//')) {
            return baseFetch(input, init)
        }
        const store = requestContext.getStore()
        if (!store) {
            return baseFetch(input, init)
        }
        const resolvedUrl = new URL(raw, store.url)
        const forwarded = buildForwardedRequest(input, init, resolvedUrl, store)

        // single-flight only safe methods; mutations must always re-execute.
        if (forwarded.method === 'GET' || forwarded.method === 'HEAD') {
            const key = `${forwarded.method} ${resolvedUrl.href}`
            const cached = store.fetchCache.get(key)
            if (cached) {
                return cached.then((response) => response.clone())
            }
            const inflight = dispatchOrFetch(forwarded, resolvedUrl, store, baseFetch)
            store.fetchCache.set(key, inflight)
            return inflight.then((response) => response.clone())
        }

        return dispatchOrFetch(forwarded, resolvedUrl, store, baseFetch)
    }) as typeof fetch
}

/*
Routes a forwarded subrequest either to an in-process api handler (skipping
network/serialization entirely) or to the underlying fetch when no api is
registered at that path. Records timing under the request's trace ledger.
*/
async function dispatchOrFetch(
    req: Request,
    resolvedUrl: URL,
    store: RequestStore,
    baseFetch: typeof globalThis.fetch,
): Promise<Response> {
    const start = store.trace ? Bun.nanoseconds() : 0
    const label = `${req.method} ${resolvedUrl.pathname}`
    if (store.apiDispatch) {
        const response = await store.apiDispatch(req)
        if (response) {
            recordTrace(store, 'api', label, start)
            return response
        }
    }
    const response = await baseFetch(req)
    recordTrace(store, 'fetch', label, start)
    return response
}

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

/*
Memoizes a dynamic-import-style loader per request. Repeated lookups for
the same module (e.g. a route that resolves twice via internal subrequest)
share a single load promise.
*/
function cachedLoad<T>(store: RequestStore, cacheKey: string, load: () => Promise<T>): Promise<T> {
    const existing = store.moduleCache.get(cacheKey) as Promise<T> | undefined
    if (existing) {
        return existing
    }
    const start = store.trace ? Bun.nanoseconds() : 0
    const promise = load().then((value) => {
        recordTrace(store, 'module', cacheKey, start)
        return value
    })
    store.moduleCache.set(cacheKey, promise)
    return promise
}

/*
Runs every layout resolve in parallel, collects results in declaration
order, and shallow-merges root-to-leaf. A redirect anywhere wins the chain;
the work of sibling resolves is discarded. Resolves must not depend on
parent data because they no longer run sequentially.
*/
async function reduceResolves(
    loaders: Array<{ prefix: string; load: () => Promise<LayoutDataModule> }>,
    ctx: ResolveContext,
    store: RequestStore,
): Promise<{ kind: 'ok'; data: Record<string, unknown> } | { kind: 'redirect'; to: string }> {
    const results = await Promise.all(
        loaders.map(async ({ prefix, load }) => {
            const mod = await cachedLoad(store, `layout-data:${prefix}`, load)
            if (!mod.resolve) {
                return undefined
            }
            const start = store.trace ? Bun.nanoseconds() : 0
            const value = await mod.resolve(ctx)
            recordTrace(store, 'resolve', `resolve:${prefix}`, start)
            return value
        }),
    )
    const data: Record<string, unknown> = {}
    for (const value of results) {
        if (!value) {
            continue
        }
        if (value.redirect) {
            return { kind: 'redirect', to: value.redirect }
        }
        if (value.data) {
            Object.assign(data, value.data)
        }
    }
    return { kind: 'ok', data }
}

const DEFAULT_SOCKET_PATH = '/__belte/socket'

// SSR responses depend on per-request state (cookies, resolve functions); never reuse without revalidating.
const SSR_CACHE_CONTROL = 'private, no-cache'
const NO_STORE = 'no-store'

/*
Builds the right Response shape for a redirect depending on whether the
client asked for HTML (real 302/303) or JSON (envelope with the target so
the client router can perform the navigation).
*/
function redirectResponse(req: Request, to: string, json: boolean): Response {
    if (json) {
        return Response.json(
            { redirect: to },
            { headers: { Vary: 'Accept', 'Cache-Control': SSR_CACHE_CONTROL } },
        )
    }
    // 303 forces a GET on the redirect target for non-safe methods (POST-redirect-GET).
    const status = req.method === 'GET' || req.method === 'HEAD' ? 302 : 303
    return new Response(undefined, {
        status,
        headers: { Location: to, Vary: 'Accept', 'Cache-Control': SSR_CACHE_CONTROL },
    })
}

/*
Invokes the method handler on an api module. Returns undefined when the
module has no handler for the request method — callers decide whether
that means 405 (pure api) or fall-through to the page render (page+api GET).
*/
async function invokeApi(
    mod: ApiModule,
    req: Request,
    params: Record<string, string>,
    routeLabel: string,
    store: RequestStore,
): Promise<Response | { data?: Record<string, unknown>; redirect?: string } | undefined> {
    const handler = mod[req.method.toUpperCase()] as ApiHandler | undefined
    if (!handler) {
        return undefined
    }
    const start = store.trace ? Bun.nanoseconds() : 0
    const result = await handler(req, params)
    recordTrace(store, 'api', `${req.method} ${routeLabel}`, start)
    return result
}

function methodNotAllowed(mod: ApiModule, allowsPage: boolean): Response {
    const allow = allowsPage
        ? Array.from(new Set(['GET', 'HEAD', ...Object.keys(mod)])).join(', ')
        : Object.keys(mod).join(', ')
    return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: allow, 'Cache-Control': NO_STORE },
    })
}

/*
Merges any setHeader/setCookie/setStatus calls made during the request onto
the outgoing Response. Returns the original Response untouched when nothing
was buffered.
*/
function applyResponseMutations(response: Response, store: RequestStore): Response {
    const mut = store.response
    if (mut.cookies.length === 0 && mut.status === undefined && mut.headers.keys().next().done) {
        return response
    }
    const headers = new Headers(response.headers)
    mut.headers.forEach((value, name) => {
        headers.set(name, value)
    })
    mut.cookies.forEach((cookie) => {
        headers.append('Set-Cookie', cookie)
    })
    return new Response(response.body, {
        status: mut.status ?? response.status,
        statusText: response.statusText,
        headers,
    })
}

/*
Pretty-prints the per-request trace ledger as a column-aligned list,
sorted by occurrence order so causality is preserved.
*/
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

type Resolved =
    | {
          kind: 'ok'
          route: string
          params: Record<string, string>
          data: Record<string, unknown>
      }
    | { kind: 'redirect'; to: string }

/*
Starts a Bun HTTP server that ties together the routing, layout chain,
SSR rendering, api handlers, and (optionally) a websocket upgrade endpoint.
The same handler serves both HTML (browser) and JSON (client navigation)
responses based on the Accept header.
*/
export async function createServer<TSocketData = unknown>({
    routes,
    apis,
    layouts,
    shell,
    socket,
    socketUpgrade,
    socketPath = DEFAULT_SOCKET_PATH,
    assets,
    distDir = `${process.cwd()}/dist`,
    port = Number(process.env.PORT ?? 3000),
}: {
    routes: Routes
    apis?: ApiRoutes
    layouts?: Layouts
    shell: string
    socket?: WebSocketHandler<TSocketData>
    socketUpgrade?: SocketUpgrade<TSocketData>
    socketPath?: string
    assets?: Assets
    distDir?: string
    port?: number
}): Promise<Server> {
    const effectiveRoutesDir = realpathSync(await materializeStubRoutes(routes, apis))

    const router = new Bun.FileSystemRouter({
        style: 'nextjs',
        dir: effectiveRoutesDir,
        fileExtensions: ['.svelte', '.ts'],
    })

    const routesDirNorm = effectiveRoutesDir.replace(/\/$/, '')
    const routeKeyByFile = new Map<string, string>(
        Object.keys(routes).map((key) => [`${routesDirNorm}/${key}.svelte`, key]),
    )
    const apiKeyByFile = new Map<string, string>(
        Object.keys(apis ?? {}).map((key) => [`${routesDirNorm}/${key}.ts`, key]),
    )

    const diskGzipPaths = new Set<string>(
        !assets && (await Bun.file(`${distDir}/_app`).exists())
            ? (await Array.fromAsync(new Glob('**/*.gz').scan({ cwd: `${distDir}/_app` }))).map(
                  (file) => `/_app/${file.replace(/\.gz$/, '')}`,
              )
            : [],
    )

    /*
    Dispatches a path-relative subrequest to a colocated pure-api route
    (.ts file) without going through the HTTP stack. Returns undefined when
    no api is registered at that path, when the path resolves to a page+api
    pair (envelope-shaped result wouldn't round-trip via Response), or when
    the route doesn't exist — letting the patched fetch fall back to baseFetch.
    */
    async function dispatchInProcessApi(req: Request): Promise<Response | undefined> {
        const store = requestContext.getStore()
        if (!store) {
            return undefined
        }
        const url = new URL(req.url)
        const match = router.match(url.pathname)
        if (!match || !match.filePath.endsWith('.ts')) {
            return undefined
        }
        const apiKey = apiKeyByFile.get(match.filePath)
        const loader = apiKey ? apis?.[apiKey] : undefined
        if (!loader || !apiKey) {
            return undefined
        }
        const mod = await cachedLoad(store, `api:${apiKey}`, loader)
        const result = await invokeApi(mod, req, match.params ?? {}, apiKey, store)
        if (result === undefined) {
            return methodNotAllowed(mod, false)
        }
        if (!(result instanceof Response)) {
            throw new Error(
                `[belte] apis['${apiKey}'].${req.method} must return a Response — { data, redirect } is only valid when a page exists at the same route`,
            )
        }
        return result
    }

    async function resolveData(
        route: string,
        params: Record<string, string>,
        resolveLoaders: Array<{ prefix: string; load: () => Promise<LayoutDataModule> }>,
        store: RequestStore,
    ): Promise<Resolved> {
        const out = await reduceResolves(
            resolveLoaders,
            { req: store.req, url: store.url, route, params },
            store,
        )
        if (out.kind === 'redirect') {
            return out
        }
        return { kind: 'ok', route, params, data: out.data }
    }

    async function loadViewChain(
        viewLoaders: ReturnType<typeof layoutLoadersFor<'view'>>,
        store: RequestStore,
    ): Promise<Array<{ key: string; Component: Component }>> {
        return Promise.all(
            viewLoaders.map(async ({ prefix, load }) => ({
                key: prefix,
                Component: (await cachedLoad(store, `layout-view:${prefix}`, load)).default,
            })),
        )
    }

    patchFetch()
    const logRequests = isDebugEnabled('belte')
    const tracingEnabled = isDebugEnabled('belte:trace')

    /*
    Core request dispatch. In order: websocket upgrade, static asset, api-only
    route (.ts), page route (.svelte) — which itself runs the resolve chain,
    optionally invokes the colocated api handler, and either returns JSON or
    renders the SSR shell. Returns undefined when an upgrade succeeded and the
    server has taken over the connection.
    */
    async function handle(srv: Server, store: RequestStore): Promise<Response | undefined> {
        const { req, url } = store
        if (socket && url.pathname === socketPath) {
            const upgradeOpts = socketUpgrade
                ? await socketUpgrade(req)
                : { data: {} as TSocketData }
            if (upgradeOpts === false) {
                return new Response('Forbidden', { status: 403 })
            }
            if (srv.upgrade(req, upgradeOpts)) {
                return undefined
            }
            return new Response('Upgrade failed', { status: 400 })
        }

        if (url.pathname.startsWith('/_app/')) {
            const mime = contentType(url.pathname)
            const wantsGzip = acceptsGzip(req)
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
                if (wantsGzip) {
                    return new Response(gzipped, { headers: gzipHeaders })
                }
                return new Response(Bun.gunzipSync(gzipped), { headers: baseHeaders })
            }
            const diskPath = distDir + url.pathname
            if (wantsGzip && diskGzipPaths.has(url.pathname)) {
                return new Response(Bun.file(`${diskPath}.gz`), { headers: gzipHeaders })
            }
            return new Response(Bun.file(diskPath), { headers: baseHeaders })
        }

        const match = router.match(url.pathname)
        if (!match) {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Cache-Control': NO_STORE },
            })
        }

        if (match.filePath.endsWith('.ts')) {
            const apiKey = apiKeyByFile.get(match.filePath)
            const loader = apiKey ? apis?.[apiKey] : undefined
            if (!loader || !apiKey) {
                return new Response('Not Found', {
                    status: 404,
                    headers: { 'Cache-Control': NO_STORE },
                })
            }
            const mod = await cachedLoad(store, `api:${apiKey}`, loader)
            const result = await invokeApi(mod, req, match.params ?? {}, apiKey, store)
            if (result === undefined) {
                return methodNotAllowed(mod, false)
            }
            if (!(result instanceof Response)) {
                throw new Error(
                    `[belte] apis['${apiKey}'].${req.method} must return a Response — { data, redirect } is only valid when a page exists at the same route`,
                )
            }
            return result
        }

        const route = routeKeyByFile.get(match.filePath)
        if (!route) {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Cache-Control': NO_STORE },
            })
        }
        const params = match.params ?? {}

        const resolveLoaders = layoutLoadersFor(route, layouts, 'resolve')
        const viewLoaders = layoutLoadersFor(route, layouts, 'view')
        const json = wantsJson(req)

        const resolved = await resolveData(route, params, resolveLoaders, store)
        if (resolved.kind === 'redirect') {
            return redirectResponse(req, resolved.to, json)
        }

        let actionData: Record<string, unknown> = {}
        // HEAD is served by the page render (body stripped by runtime); skip api invocation.
        if (apis?.[route] && req.method !== 'HEAD') {
            const mod = await cachedLoad(store, `api:${route}`, apis[route])
            const result = await invokeApi(mod, req, params, route, store)
            if (result === undefined) {
                if (req.method !== 'GET') {
                    return methodNotAllowed(mod, true)
                }
                // GET with no handler falls through to render the page.
            } else if (result instanceof Response) {
                return result
            } else if (typeof result.redirect === 'string') {
                return redirectResponse(req, result.redirect, json)
            } else {
                actionData = result.data ?? {}
            }
        }

        const data = { ...resolved.data, ...actionData }

        if (json) {
            return Response.json(
                {
                    route,
                    params,
                    data,
                },
                { headers: { Vary: 'Accept', 'Cache-Control': SSR_CACHE_CONTROL } },
            )
        }

        const [pageMod, viewChain] = await Promise.all([
            cachedLoad(store, `route:${route}`, routes[route]),
            loadViewChain(viewLoaders, store),
        ])

        const rendered = await render(App, {
            props: {
                state: {
                    layouts: viewChain,
                    Page: pageMod.default,
                    params,
                    data,
                },
            },
        })

        const stateTag = `<script>window.__SSR__ = ${JSON.stringify({
            route,
            params,
            data,
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

    // Bun.serve is the network IO boundary — impure shell around pure handlers
    const server = Bun.serve({
        port,
        ...(socket ? { websocket: socket } : {}),

        async fetch(req, srv) {
            const url = new URL(req.url)
            const store: RequestStore = {
                url,
                req,
                signal: req.signal,
                fetchCache: new Map(),
                moduleCache: new Map(),
                response: {
                    headers: new Headers(),
                    cookies: [],
                    status: undefined,
                },
                apiDispatch: dispatchInProcessApi,
                trace: tracingEnabled ? [] : undefined,
            }
            return requestContext.run(store, async () => {
                const start = logRequests ? Bun.nanoseconds() : 0
                const response = await handle(srv, store)
                if (logRequests) {
                    const ms = (Bun.nanoseconds() - start) / 1e6
                    const status = response ? response.status : 101
                    log.request(req.method, `${url.pathname}${url.search}`, status, ms)
                }
                if (store.trace && store.trace.length > 0) {
                    log.debug('belte:trace', `\n${formatTrace(store.trace)}`)
                }
                if (!response) {
                    return response as unknown as Response
                }
                return applyResponseMutations(response, store)
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

    log.success(`ready at http://localhost:${server.port}`)
    return server
}

/*
filesystem write is unavoidable — Bun.FileSystemRouter requires a real dir on disk.
When a page and an api share the same key, only the page stub is written; the api is
looked up separately by route key in handle(). Bun's FSRouter rejects two stubs at
the same URL, so we deduplicate here.
*/
async function materializeStubRoutes(routes: Routes, apis: ApiRoutes | undefined): Promise<string> {
    const dir = mkdtempSync(`${tmpdir()}/belte-routes-`)
    await Promise.all([
        ...Object.keys(routes).map((key) => Bun.write(`${dir}/${key}.svelte`, '')),
        ...Object.keys(apis ?? {})
            .filter((key) => !routes[key])
            .map((key) => Bun.write(`${dir}/${key}.ts`, '')),
    ])
    return dir
}
