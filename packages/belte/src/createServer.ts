import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Server, WebSocketHandler } from 'bun'
import { Glob } from 'bun'
import { render } from 'svelte/server'
import type { ApiRoutes } from './ApiRoutes.ts'
import App from './App.svelte'
import { isDebugEnabled } from './debug.ts'
import type { Layouts } from './Layouts.ts'
import { log } from './log.ts'
import type { Routes } from './Routes.ts'
import { layoutPrefixesFor } from './routePrefixes.ts'

export type Assets = Record<string, Uint8Array>

function acceptsGzip(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
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

export type ResolveContext = {
    req: Request
    url: URL
    route: string
    params: Record<string, string>
}

export type ResolveResult = {
    data?: Record<string, unknown>
    redirect?: string
}

export type ResolveHook = (ctx: ResolveContext) => ResolveResult | Promise<ResolveResult>

export type SocketUpgrade<T> = (req: Request) => false | { data: T } | Promise<false | { data: T }>

const DEFAULT_SOCKET_PATH = '/__belte/socket'

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
    const effectiveRoutesDir = realpathSync(materializeStubRoutes(routes, apis))

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

    const diskGzipPaths = new Set<string>()
    if (!assets && existsSync(`${distDir}/_app`)) {
        const gzGlob = new Glob('**/*.gz')
        for await (const f of gzGlob.scan({ cwd: `${distDir}/_app` })) {
            diskGzipPaths.add(`/_app/${f.replace(/\.gz$/, '')}`)
        }
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

    async function resolveData(
        req: Request,
        url: URL,
        route: string,
        params: Record<string, string>,
        resolvePrefixes: string[],
    ): Promise<Resolved> {
        const data: Record<string, unknown> = {}
        for (const prefix of resolvePrefixes) {
            const mod = await (layouts as Layouts)[prefix].resolve!()
            if (!mod.resolve) {
                continue
            }
            const result = await mod.resolve({ req, url, route, params })
            if (result.redirect) {
                return { kind: 'redirect', to: result.redirect }
            }
            Object.assign(data, result.data ?? {})
        }
        return { kind: 'ok', route, params, data }
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

    const logRequests = isDebugEnabled('belte')

    async function resolvePageByPath(req: Request, url: URL, pathname: string): Promise<Resolved> {
        const match = router.match(pathname)
        if (!match) {
            return { kind: 'notfound' }
        }
        const route = routeKeyByFile.get(match.filePath)
        if (!route) {
            return { kind: 'notfound' }
        }
        const params = match.params ?? {}
        return resolveData(req, url, route, params, layoutPrefixesFor(route, layouts, 'resolve'))
    }

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
            if (assets) {
                const gzipped = assets[url.pathname]
                if (!gzipped) {
                    return new Response('Not Found', { status: 404 })
                }
                if (wantsGzip) {
                    return new Response(gzipped, {
                        headers: { 'Content-Type': mime, 'Content-Encoding': 'gzip' },
                    })
                }
                return new Response(Bun.gunzipSync(gzipped), {
                    headers: { 'Content-Type': mime },
                })
            }
            const diskPath = distDir + url.pathname
            if (wantsGzip && diskGzipPaths.has(url.pathname)) {
                return new Response(Bun.file(`${diskPath}.gz`), {
                    headers: { 'Content-Type': mime, 'Content-Encoding': 'gzip' },
                })
            }
            return new Response(Bun.file(diskPath))
        }

        if (url.pathname === '/__belte/resolve') {
            const target = url.searchParams.get('p') ?? '/'
            const result = await resolvePageByPath(req, url, target)
            if (result.kind === 'notfound') {
                return Response.json({ status: 404 }, { status: 404 })
            }
            if (result.kind === 'redirect') {
                return Response.json({ redirect: result.to })
            }
            return Response.json({
                route: result.route,
                params: result.params,
                data: result.data,
            })
        }

        const match = router.match(url.pathname)
        if (!match) {
            return new Response('Not Found', { status: 404 })
        }

        if (match.filePath.endsWith('.ts')) {
            const apiKey = apiKeyByFile.get(match.filePath)
            const loader = apiKey ? apis?.[apiKey] : undefined
            if (!loader) {
                return new Response('Not Found', { status: 404 })
            }
            const mod = await loader()
            const handler = mod[req.method.toUpperCase()]
            if (!handler) {
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: { Allow: Object.keys(mod).join(', ') },
                })
            }
            return handler(req, match.params ?? {})
        }

        const route = routeKeyByFile.get(match.filePath)
        if (!route) {
            return new Response('Not Found', { status: 404 })
        }
        const params = match.params ?? {}
        const resolvePrefixes = layoutPrefixesFor(route, layouts, 'resolve')
        const viewPrefixes = layoutPrefixesFor(route, layouts, 'view')
        const resolved = await resolveData(req, url, route, params, resolvePrefixes)
        if (resolved.kind === 'redirect') {
            return new Response(undefined, {
                status: 302,
                headers: { Location: resolved.to },
            })
        }

        const [{ default: Page }, viewChain] = await Promise.all([
            routes[route](),
            loadViewChain(viewPrefixes),
        ])

        const rendered = render(App, {
            props: {
                state: {
                    layouts: viewChain,
                    Page,
                    params,
                    data: resolved.data,
                },
            },
        })

        const stateTag = `<script>window.__SSR__ = ${JSON.stringify({
            route,
            params,
            data: resolved.data,
        })};</script>`

        const html = shell
            .replace('<!--ssr:head-->', rendered.head)
            .replace('<!--ssr:body-->', rendered.body)
            .replace('<!--ssr:state-->', stateTag)

        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
    }

    const server = Bun.serve({
        port,
        ...(socket ? { websocket: socket } : {}),

        async fetch(req, srv) {
            const url = new URL(req.url)
            const start = logRequests ? Bun.nanoseconds() : 0
            const response = await handle(req, srv, url)
            if (logRequests) {
                const ms = (Bun.nanoseconds() - start) / 1e6
                const status = response ? response.status : 101
                log.request(req.method, `${url.pathname}${url.search}`, status, ms)
            }
            return response as Response
        },

        error(err) {
            log.error(err)
            return new Response(`<pre>${String(err.stack ?? err)}</pre>`, {
                status: 500,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
        },
    })

    log.success(`ready at http://localhost:${server.port}`)
    return server
}

function materializeStubRoutes(routes: Routes, apis: ApiRoutes | undefined): string {
    const dir = mkdtempSync(join(tmpdir(), 'belte-routes-'))
    for (const key of Object.keys(routes)) {
        const stubPath = join(dir, `${key}.svelte`)
        mkdirSync(dirname(stubPath), { recursive: true })
        writeFileSync(stubPath, '')
    }
    for (const key of Object.keys(apis ?? {})) {
        const stubPath = join(dir, `${key}.ts`)
        mkdirSync(dirname(stubPath), { recursive: true })
        writeFileSync(stubPath, '')
    }
    return dir
}
