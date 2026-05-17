// node:fs — mkdtempSync, realpathSync have no Bun equivalent
import { mkdtempSync, realpathSync } from 'node:fs'
// node:os — tmpdir has no Bun equivalent
import { tmpdir } from 'node:os'
import type { Server, WebSocketHandler } from 'bun'
import { Glob } from 'bun'
import { render } from 'svelte/server'
import App from '../../App.svelte'
import { isDebugEnabled } from '../shared/isDebugEnabled.ts'
import { layoutPrefixesFor } from '../shared/layoutPrefixesFor.ts'
import { log } from '../shared/log.ts'
import type { ApiRoutes } from '../types/ApiRoutes.ts'
import type { Assets } from '../types/Assets.ts'
import type { Layouts } from '../types/Layouts.ts'
import type { ResolveContext } from '../types/ResolveContext.ts'
import type { Routes } from '../types/Routes.ts'
import type { SocketUpgrade } from '../types/SocketUpgrade.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { requestContext } from './requestContext.ts'

function acceptsGzip(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
}

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

function patchFetch(): void {
    if (fetchPatched) {
        return
    }
    fetchPatched = true
    const baseFetch = globalThis.fetch
    globalThis.fetch = ((input, init) => {
        const raw = rawUrl(input)
        // "/foo" is path-relative (resolve against the request); "//host" is protocol-relative (leave alone).
        if (!raw.startsWith('/') || raw.startsWith('//')) {
            return baseFetch(input, init)
        }
        const ctx = requestContext.getStore()
        if (!ctx) {
            return baseFetch(input, init)
        }
        const resolved = new URL(raw, ctx.url)
        if (input instanceof Request) {
            return baseFetch(new Request(resolved, input), init)
        }
        return baseFetch(resolved, init)
    }) as typeof fetch
}

const DEFAULT_SOCKET_PATH = '/__belte/socket'

// SSR responses depend on per-request state (cookies, resolve functions); never reuse without revalidating.
const SSR_CACHE_CONTROL = 'private, no-cache'
const NO_STORE = 'no-store'

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

type Resolved =
    | {
          kind: 'ok'
          route: string
          params: Record<string, string>
          data: Record<string, unknown>
      }
    | { kind: 'redirect'; to: string }
    | { kind: 'notfound' }

async function reduceResolves(
    layouts: Layouts,
    prefixes: string[],
    ctx: ResolveContext,
    acc: Record<string, unknown>,
): Promise<{ kind: 'ok'; data: Record<string, unknown> } | { kind: 'redirect'; to: string }> {
    if (prefixes.length === 0) {
        return { kind: 'ok', data: acc }
    }
    const [head, ...rest] = prefixes
    const mod = await layouts[head].resolve!()
    if (!mod.resolve) {
        return reduceResolves(layouts, rest, ctx, acc)
    }
    const result = await mod.resolve(ctx)
    if (result.redirect) {
        return { kind: 'redirect', to: result.redirect }
    }
    return reduceResolves(layouts, rest, ctx, { ...acc, ...(result.data ?? {}) })
}

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
                  (f) => `/_app/${f.replace(/\.gz$/, '')}`,
              )
            : [],
    )

    async function resolveData(
        req: Request,
        url: URL,
        route: string,
        params: Record<string, string>,
        resolvePrefixes: string[],
    ): Promise<Resolved> {
        const out = await reduceResolves(
            layouts as Layouts,
            resolvePrefixes,
            { req, url, route, params },
            {},
        )
        if (out.kind === 'redirect') {
            return out
        }
        return { kind: 'ok', route, params, data: out.data }
    }

    async function loadViewChain(
        viewPrefixes: string[],
    ): Promise<Array<{ key: string; Component: any }>> {
        return Promise.all(
            viewPrefixes.map(async (p) => ({
                key: p,
                Component: (await (layouts as Layouts)[p].view!()).default,
            })),
        )
    }

    patchFetch()
    const logRequests = isDebugEnabled('belte')

    async function handle(req: Request, srv: Server, url: URL): Promise<Response | undefined> {
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
            if (!loader) {
                return new Response('Not Found', {
                    status: 404,
                    headers: { 'Cache-Control': NO_STORE },
                })
            }
            const mod = await loader()
            const handler = mod[req.method.toUpperCase()]
            if (!handler) {
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: {
                        Allow: Object.keys(mod).join(', '),
                        'Cache-Control': NO_STORE,
                    },
                })
            }
            const result = await handler(req, match.params ?? {})
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

        const resolvePrefixes = layoutPrefixesFor(route, layouts, 'resolve')
        const viewPrefixes = layoutPrefixesFor(route, layouts, 'view')
        const json = wantsJson(req)

        const resolved = await resolveData(req, url, route, params, resolvePrefixes)
        if (resolved.kind === 'redirect') {
            return redirectResponse(req, resolved.to, json)
        }

        let actionData: Record<string, unknown> = {}
        // HEAD is served by the page render (body stripped by runtime); skip api invocation.
        if (apis?.[route] && req.method !== 'HEAD') {
            const mod = await apis[route]()
            const handler = mod[req.method.toUpperCase()]
            if (handler) {
                const result = await handler(req, params)
                if (result instanceof Response) {
                    return result
                }
                if (typeof result.redirect === 'string') {
                    return redirectResponse(req, result.redirect, json)
                }
                actionData = result.data ?? {}
            } else if (req.method !== 'GET') {
                const allow = Array.from(new Set(['GET', 'HEAD', ...Object.keys(mod)])).join(', ')
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: { Allow: allow, 'Cache-Control': NO_STORE },
                })
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

        const [{ default: Page }, viewChain] = await Promise.all([
            routes[route](),
            loadViewChain(viewPrefixes),
        ])

        const rendered = await render(App, {
            props: {
                state: {
                    layouts: viewChain,
                    Page,
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
            return requestContext.run({ url }, async () => {
                const start = logRequests ? Bun.nanoseconds() : 0
                const response = await handle(req, srv, url)
                if (logRequests) {
                    const ms = (Bun.nanoseconds() - start) / 1e6
                    const status = response ? response.status : 101
                    log.request(req.method, `${url.pathname}${url.search}`, status, ms)
                }
                return response as Response
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

// filesystem write is unavoidable — Bun.FileSystemRouter requires a real dir on disk
// When a page and an api share the same key, only the page stub is written; the api is
// looked up separately by route key in handle(). Bun's FSRouter rejects two stubs at
// the same URL, so we deduplicate here.
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
