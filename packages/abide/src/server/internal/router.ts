// The abide APP ROUTER — boots Bun.serve and dispatches each request (M2 + M7 auth).
//
// For every request the router resolves the caller's identity via the built-in bearer/cookie
// ladder (auth.ts), builds a fresh RequestScope (raw Request, parsed cookies, that identity,
// empty bag, route info derived from the URL, the Bun server, and a per-request cache Map),
// runs the composed middleware onion — global middleware wrapping the matched rpc's own
// middleware wrapping the handler — inside that scope, then re-seals the rolling abide-identity
// cookie onto the Response (unless the caller is a stateless machine bearer).
//
// CSRF (AU8): mutating requests (POST/PUT/PATCH/DELETE) are rejected unless they carry the
// abide client's non-simple request shape (Content-Type: application/json or an `x-abide`
// header) — a cross-site <form> cannot set those. When APP_URL is set and an Origin header is
// present, a mismatched Origin is also rejected. Reads (GET/HEAD) are exempt.
//
// Routing is intentionally thin: `/rpc/<name>` dispatches to a registered Rpc/Mutation,
// `/__abide/health` reports reachability, everything else 404s. Read rpcs (GET/HEAD) take
// their args from the `?args=` query param and go through the cache-backed `load`; mutations
// take args from the JSON body and call the handler directly. A handler that already returned
// a Response passes through untouched; a bare value is wrapped in `json()`.

import { health } from '../../shared/health.ts'
import { getContext } from '../../shared/internal/context.ts'
import { asStandardSchema } from '../../shared/internal/jsonSchema.ts'
import { streamEncodingOf } from '../../shared/internal/responseSource.ts'
import { jsonSchemaOf, shapeToSchema } from '../../shared/internal/shapeToSchema.ts'
import { log } from '../../shared/log.ts'
import { validateStandard } from '../../shared/StandardSchema.ts'
import { validationError } from '../../shared/ValidationErrorData.ts'
import { error } from '../error.ts'
import { json } from '../json.ts'
import { jsonl } from '../jsonl.ts'
import type { Socket } from '../socket.ts'
import { sse } from '../sse.ts'
import { applyResponseHeaders } from './applyResponseHeaders.ts'
import { clearIdentityCookieHeader, identityCookieHeader, resolveIdentity } from './auth.ts'
import {
    type CacheFrame,
    cacheChannelHub,
    cacheChannelName,
    publishCacheFrame,
} from './cacheChannels.ts'
import { authorizeChannelJoin, isCacheChannel, type SocketConnectionData } from './channelAuth.ts'
import { type ClientBuild, clientBuildFor } from './clientBundle.ts'
import {
    applyCors,
    corsAllowOrigin,
    type NormalizedCors,
    normalizeCrossOrigin,
    preflightResponse,
} from './cors.ts'
import { sharedLayoutDepth } from './layouts.ts'
import type { Mutation, Rpc, StreamRead } from './makeRpc.ts'
import { matchRoute } from './matchRoute.ts'
import { handleMcp } from './mcp.ts'
import { compose, type Middleware } from './middleware.ts'
import { buildOpenApi } from './openapi.ts'
import { renderPage, streamPageDocument, streamSoftNav } from './pages.ts'
import { projectFormText } from './projectFormText.ts'
import { buildRegistry } from './registry.ts'
import {
    anonymousPrincipal,
    type Principal,
    type RequestScope,
    type RouteInfo,
    type RouteKind,
    runInScope,
} from './scope.ts'
import { validateFiles } from './validateFiles.ts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// A streaming read result is an AsyncIterable of decoded chunks (a ReplayableStream `consume()` cursor);
// the router transport-encodes it (jsonl/sse). A plain value/object is not async-iterable.
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
    )
}

// W3C Trace Context (CO2.3): `version-traceid-spanid-flags`, all lower-case hex. Used to validate
// an incoming `traceparent` header before propagating it onto the request scope.
const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/

// A request carries an Authorization: Bearer token → it is a stateless machine surface whose
// identity is request-scoped and never persisted into an abide-identity cookie (AU6.3).
function isMachineBearer(request: Request): boolean {
    const authorization = request.headers.get('authorization')
    return authorization !== null && /^Bearer\s+/i.test(authorization.trim())
}

// AU8 CSRF gate. Returns a 403 Response to reject, or undefined to allow. Only mutating methods
// are checked; reads are exempt (they cannot mutate, and Lax cookies already ride them safely).
function csrfReject(request: Request, cors: NormalizedCors | undefined): Response | undefined {
    if (!MUTATING_METHODS.has(request.method.toUpperCase())) return undefined

    const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
    const hasAbideHeader = request.headers.get('x-abide') !== null
    // Compare the BASE media type (before any `;` parameters), never a substring: a cross-site simple
    // request can smuggle `application/json` inside a spoofable parameter (e.g.
    // `multipart/form-data; boundary=application/json`) and `.includes` would wrongly clear the gate.
    // NB (TODO #8): `multipart/form-data` is a CORS "simple" content type a cross-site <form> CAN
    // send, so it does NOT count as a non-simple shape here — a multipart mutation is admitted ONLY
    // via the `x-abide` header (which a cross-site form cannot set). CSRF is not weakened for uploads.
    const mediaType = contentType.split(';', 1)[0]?.trim() ?? ''
    const hasNonSimpleShape = mediaType === 'application/json' || hasAbideHeader
    if (!hasNonSimpleShape) {
        return error(
            403,
            'CSRF: mutations require Content-Type: application/json or an x-abide header.',
        )
    }

    const origin = request.headers.get('origin')
    const appUrl = Bun.env.APP_URL
    if (origin !== null && appUrl !== undefined && appUrl.length > 0) {
        let originHost: string
        let appHost: string
        try {
            originHost = new URL(origin).origin
            appHost = new URL(appUrl).origin
        } catch {
            return error(403, 'CSRF: could not verify request Origin against APP_URL.')
        }
        // A mismatched Origin is rejected UNLESS this RPC opted into cross-origin access for it (the
        // `crossOrigin` allowlist) — CORS is the sanctioned way to admit a foreign origin.
        if (originHost !== appHost && corsAllowOrigin(cors ?? NO_CORS, origin) === undefined) {
            return error(403, 'CSRF: request Origin does not match APP_URL.')
        }
    }

    return undefined
}

// A closed CORS policy — `corsAllowOrigin` against it admits nothing, so a `crossOrigin`-less RPC keeps
// the strict same-origin CSRF behaviour without a null-branch at each call.
const NO_CORS: NormalizedCors = {
    origins: [],
    methods: '',
    headers: '',
    credentials: false,
    maxAge: 0,
}

// After dispatch, refresh (or clear) the rolling abide-identity cookie for browser identities.
// Machine-bearer callers are stateless and get no cookie, even if identity.set() ran (AU6.3).
async function applyIdentityCookie(scope: RequestScope, response: Response): Promise<void> {
    if (scope.identityStateless) return
    const header = scope.identityCleared
        ? clearIdentityCookieHeader()
        : await identityCookieHeader(scope.identity)
    response.headers.append('set-cookie', header)
}

// Last-resort handler for an error that escaped the middleware/dispatch chain (a genuine bug — typed
// error/redirect responses are returned, not thrown). Runs in request scope, so the app's `onError`
// can read request()/route()/identity() ambiently. The hook may return a Response to shape the client
// reply; anything else (or a throwing hook) falls back to a generic 500 that never leaks the detail.
async function handleUncaught(caught: unknown, config: AppConfig): Promise<Response> {
    log.channel('abide:router').error('uncaught error in dispatch:', caught)
    const onError = config.onError
    if (onError !== undefined) {
        try {
            const custom = await onError(caught)
            if (custom instanceof Response) return custom
        } catch (hookError) {
            log.channel('abide:router').error('onError hook threw:', hookError)
        }
    }
    return error(500, 'Internal Server Error')
}

// A route is anything carrying `__rpc` metadata — a value handler produces Rpc (Mutation extends it),
// a streaming handler produces StreamRead (StreamMutation extends it). The router branches on
// `__rpc.read`; `Rpc | StreamRead` covers all four verb surfaces.
// biome-ignore lint/suspicious/noExplicitAny: existential route type — the registry erases each rpc's concrete Args/T; `unknown` breaks assignability through RpcMeta's invariant Args.
export type Route = Rpc<any, any> | StreamRead<any, any>

export interface AppConfig {
    routes?: Record<string, Route>
    middleware?: Middleware[]
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — per-socket message type is erased here; `unknown` breaks assignability through the invariant Socket message type.
    sockets?: Record<string, Socket<any>>
    // M5a: page.abide sources keyed by exact request path (e.g. '/' → "<h1>…</h1>"). A GET/HEAD nav
    // request matching a page path is SSR'd to a full HTML document. File-based page discovery is M5b.
    pages?: Record<string, string>
    // TODO #7: layout.abide sources keyed by the directory route prefix they wrap (e.g. '/' → the root
    // layout, '/admin' → the admin-subtree layout). A page's applicable layouts (root → nearest) wrap it
    // outer→inner, each rendering the next level where it calls `{children()}`. See internal/layouts.ts.
    layouts?: Record<string, string>
    // TODO #20: absolute source DIRECTORY of each page/layout `.abide` file, keyed the same as
    // `pages`/`layouts`. Populated by the file loader; used only by the client bundle to resolve a
    // page's RELATIVE CSS imports (`import "./styles.css"`) to absolute paths so `Bun.build` (running
    // from a tmpdir entry) can find them. Absent for hand-built configs (no relative CSS to resolve).
    pageDirs?: Record<string, string>
    layoutDirs?: Record<string, string>
    // BP3: listen port for `Bun.serve`. Absent → 0 (ephemeral, e.g. createTestApp / hand-built configs).
    // The CLI's `serve` always resolves a concrete port (`--port` / `PORT` / 3000, dev hops to the next open one).
    port?: number
    // BP2.3: dev-only JS injected as an inline `<script>` into every SSR'd page document — the
    // live-reload client that subscribes to the reserved dev-reload channel on the socket mux and
    // reloads the page on signal. Absent in production; set only by `abide dev`.
    devReloadScript?: string
    // BP1: production vs development build. Set explicitly by the CLI — `abide dev` → true, `abide
    // build`/`abide start` → false. Absent for tests/`createTestApp`/hand-built configs. Gates client-
    // bundle MINIFICATION: only an explicit production build (`dev === false`) minifies, so dev stays
    // fast + readable and tests keep their unminified assertions (TODO #6). See clientBundle.ts.
    dev?: boolean
    // BP3: a PRE-BUILT client loaded from `dist/_app/<hash>/` (by `abide start`). When set, the router
    // serves these artifacts as-is and NEVER runs `Bun.build` at request time — production serves the
    // exact output of `abide build`. Absent in dev/test → the client is built in-memory on first use.
    clientBuild?: ClientBuild
    // CO2.4: the app-defined health hook (`src/app.ts` export `onHealth`). Runs INSIDE request scope on
    // every `GET /__abide/health`, takes no args, and returns fields merged over the framework stub
    // (`{ reachable, version, startedAt, uptime }`) — app fields win, so it can force `reachable: false`.
    // A thrown hook (or a returned `reachable: false`) makes the endpoint answer 503. Non-object returns
    // are ignored (stub passes through). Unlike onStart/onStop this is router-consumed, so it lives here.
    onHealth?: () => unknown | Promise<unknown>
    // The app-defined error hook (`src/app.ts` export `onError`). Runs INSIDE request scope when the
    // middleware/dispatch chain THROWS an unexpected error (a typed `error(...)`/`redirect(...)` return
    // is a Response, not a throw, so it never reaches here). May return a `Response` to shape what the
    // client gets; returning nothing falls back to a generic 500. A throwing onError is itself caught
    // and falls back to 500. This is the outermost net for genuine bugs — not a substitute for
    // middleware auth or typed errors.
    // Returns `unknown` (like onHealth) so any handler shape is accepted — return a `Response` to shape
    // the reply, or nothing to fall back to the generic 500. handleUncaught narrows via `instanceof`.
    // Runs in request scope, so the request/route/identity are read ambiently (request(), route(), …).
    onError?: (error: unknown) => unknown
}

// Per-connection state on the multiplexed socket WS: the set of live subscriptions this client
// holds, keyed by socket name → the draining async iterator (so unsub/close can `return()` it).
interface SocketConnection {
    subscriptions: Map<string, AsyncIterator<unknown>>
}

// The multiplexed socket transport (sockets.md S3). One WS per client at `/__abide/sockets`
// carries all named sockets, framed `{ name, msg }`. The per-socket HTTP face at
// `/__abide/sockets/<name>` is the WS-less path (GET → SSE subscribe, POST → publish).

// CSWSH gate (auth.md AU8): a cookie-authenticated upgrade must be same-origin. When an Origin
// header is present and APP_URL is configured, reject a mismatched Origin. Origin-less clients
// (native WS, curl) and unconfigured APP_URL pass — a bearer/token WS carries no ambient cookie.
function socketOriginAllowed(request: Request): boolean {
    const origin = request.headers.get('origin')
    if (origin === null) return true
    const appUrl = Bun.env.APP_URL
    if (appUrl === undefined || appUrl.length === 0) return true
    try {
        return new URL(origin).origin === new URL(appUrl).origin
    } catch {
        return false
    }
}

// Drain one socket's iterator into the WS, framing each message `{ name, msg }`. Ends when the
// iterator completes, the client unsubscribed (replaced/removed in the map), or the WS closed.
async function pumpSocketToWs(
    ws: Bun.ServerWebSocket<SocketConnectionData>,
    connection: SocketConnection,
    name: string,
    iterator: AsyncIterator<unknown>,
): Promise<void> {
    try {
        while (true) {
            const result = await iterator.next()
            if (result.done === true) break
            if (connection.subscriptions.get(name) !== iterator) break
            if (ws.readyState !== 1) break
            ws.send(JSON.stringify({ name, msg: result.value }))
        }
    } catch {
        // Swallow — the connection is tearing down; cleanup happens in `finally`.
    } finally {
        await iterator.return?.()
    }
}

function wsSubscribe(
    ws: Bun.ServerWebSocket<SocketConnectionData>,
    connection: SocketConnection,
    name: unknown,
    args: unknown,
    replay: unknown,
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — per-socket message type is erased here; `unknown` breaks assignability through the invariant Socket message type.
    sockets: Record<string, Socket<any>>,
    config: AppConfig,
): void {
    if (typeof name !== 'string') return
    if (connection.subscriptions.has(name)) return
    // `@rpc:` cache-invalidation channel — the S4.4 exception: per-subscribe authorization against
    // the connection's identity, re-running the target rpc's read gate for the presented args. Cache
    // channels keep SILENT-DENY (their TTL self-heals a missed frame); user sockets do not (below).
    if (isCacheChannel(name)) {
        void subscribeCacheChannel(ws, connection, name, args, config)
        return
    }
    // Bare user-socket path (connect-authed, no per-subscribe recheck; S4.4). Unlike cache channels,
    // user sockets are OFF silent-deny (client-sockets.md CS2): an unknown socket gets a terminal
    // sub-error frame (→ client `error()`), a successful join gets a sub-ack (→ clears client
    // `pending()`). `replay: false` is the hydration join — SSR already painted the backlog (CS5).
    const sock = sockets[name]
    if (sock === undefined) {
        log.channel('abide:socket').warn(`subscribe rejected — unknown socket: ${name}`)
        ws.send(JSON.stringify({ name, error: { message: `unknown socket: ${name}` } }))
        return
    }
    const iterator = sock.__socket.subscribe(replay !== false)
    connection.subscriptions.set(name, iterator)
    ws.send(JSON.stringify({ name, ok: true }))
    log.channel('abide:socket').info(`subscribe ${name} replay=${replay !== false}`)
    void pumpSocketToWs(ws, connection, name, iterator)
}

// Authorize + join an `@rpc:` cache channel. On DENY do nothing (silent — matches the existing
// ignore-unknown-name contract; a client learns nothing about whether the channel exists or why
// it was refused). Re-runs `authorizeChannelJoin` on EVERY subscribe (never cached on the
// connection) so per-args row-level middleware authz is enforced for each join.
async function subscribeCacheChannel(
    ws: Bun.ServerWebSocket<SocketConnectionData>,
    connection: SocketConnection,
    name: string,
    args: unknown,
    config: AppConfig,
): Promise<void> {
    const allowed = await authorizeChannelJoin(name, args, ws.data, config)
    if (!allowed) {
        log.channel('abide:socket').trace(`cache-channel join denied: ${name}`)
        return
    }
    // Re-check across the await: a racing unsub/dup-sub for the same name, or a closed socket,
    // must not leave a dangling join.
    if (connection.subscriptions.has(name)) return
    if (ws.readyState !== 1) return
    const iterator = cacheChannelHub(name).subscribe()
    connection.subscriptions.set(name, iterator)
    log.channel('abide:socket').trace(`cache-channel join: ${name}`)
    void pumpSocketToWs(ws, connection, name, iterator)
}

function wsUnsubscribe(connection: SocketConnection, name: unknown): void {
    if (typeof name !== 'string') return
    const iterator = connection.subscriptions.get(name)
    if (iterator === undefined) return
    connection.subscriptions.delete(name)
    void iterator.return?.()
}

// Client publish over the WS. Ignored unless the socket opted into `clientPublish`; routed
// through the hub's `ingressPublish` so a mediating handler can transform / drop / reject.
async function wsPublish(
    name: unknown,
    message: unknown,
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — per-socket message type is erased here; `unknown` breaks assignability through the invariant Socket message type.
    sockets: Record<string, Socket<any>>,
): Promise<void> {
    if (typeof name !== 'string') return
    const sock = sockets[name]
    if (sock === undefined) return
    if (sock.__socket.options.clientPublish !== true) return
    try {
        await sock.__socket.ingressPublish(message)
    } catch {
        // A handler reject is surfaced to WS publishers as a silent drop (no request/response pair).
    }
}

// The per-socket HTTP face: GET/HEAD → SSE subscribe, POST → publish (respecting clientPublish).
async function socketHttpFace(
    request: Request,
    url: URL,
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — per-socket message type is erased here; `unknown` breaks assignability through the invariant Socket message type.
    sockets: Record<string, Socket<any>>,
): Promise<Response> {
    const name = decodeURIComponent(url.pathname.slice('/__abide/sockets/'.length))
    const sock = sockets[name]
    if (sock === undefined) return error(404, `Unknown socket: ${name}`)

    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
        return sse(sock)
    }
    if (method === 'POST') {
        if (sock.__socket.options.clientPublish !== true) {
            return error(403, `socket: client publish is disabled for ${name}.`)
        }
        const body = await request.text()
        const message = body.length > 0 ? JSON.parse(body) : undefined
        try {
            await sock.__socket.ingressPublish(message)
        } catch (caught) {
            return error(400, caught instanceof Error ? caught.message : 'socket publish rejected')
        }
        return json({ ok: true })
    }
    return error(405, `Method not allowed: ${method}`, { headers: { allow: 'GET, HEAD, POST' } })
}

export interface App {
    server: Bun.Server<undefined>
    origin: string
    stop(): Promise<void>
}

// C6-nav: a soft-nav request is a GET/HEAD nav carrying the `Abide-Nav: <currentPath>` header —
// the client already has the document shell and wants only the next page's inner HTML + seed.
function isSoftNav(request: Request): boolean {
    if (request.headers.get('abide-nav') === null) return false
    const method = request.method.toUpperCase()
    return method === 'GET' || method === 'HEAD'
}

// A soft-nav that a middleware short-circuited with a redirect Response is surfaced to the client as
// a `{ redirect }` envelope (the client performs the navigation) rather than an opaque 3xx.
function isRedirectResponse(response: Response): boolean {
    return (
        response.status >= 300 && response.status < 400 && response.headers.get('location') !== null
    )
}

function routeInfo(url: URL): { kind: RouteKind; name: string } {
    const pathname = url.pathname
    // RPC transport lives under the framework namespace (`/__abide/rpc/<name>`), alongside
    // `/__abide/sockets`, `/__abide/health`, and `/__abide/mcp` — so the `/rpc/*` URL space is free
    // for app pages. Checked after the exact `/__abide/*` endpoints in `dispatch`, none of which
    // share this prefix.
    if (pathname.startsWith('/__abide/rpc/')) {
        return { kind: 'rpc', name: pathname.slice('/__abide/rpc/'.length) }
    }
    return { kind: 'nav', name: pathname }
}

async function dispatch(
    scope: RequestScope,
    config: AppConfig,
    startedAt: number,
): Promise<Response> {
    const routes = config.routes ?? {}
    const url = scope.route.url

    if (url.pathname === '/__abide/health') {
        // Framework stub (CO2.4): the isomorphic baseline (`reachable`, running abide `version`) plus the
        // server-only lifetime fields. The app's `onHealth` (request-scoped) is merged ON TOP — its fields
        // win, so it may force `reachable: false`; a thrown hook fails closed to unhealthy.
        const stub = {
            ...(await health()),
            startedAt: new Date(startedAt).toISOString(),
            uptime: Date.now() - startedAt,
        }
        let result: Record<string, unknown> = stub
        const onHealth = config.onHealth
        if (onHealth !== undefined) {
            try {
                const extra = await onHealth()
                if (extra !== null && typeof extra === 'object')
                    result = { ...stub, ...(extra as Record<string, unknown>) }
            } catch (caught) {
                log.channel('abide:health').error('onHealth threw:', caught)
                result = { ...stub, reachable: false }
            }
        }
        const unhealthy = result.reachable === false
        // Give a probing client/proxy a concrete back-off instead of hammering an unhealthy app.
        return json(result, {
            status: unhealthy ? 503 : 200,
            ...(unhealthy ? { headers: { 'retry-after': '30' } } : {}),
        })
    }

    // Content-addressed client assets (TODO #6): the code-split loader entry + per-route chunks + shared
    // chunks + the bundled CSS, each served by its content-hashed filename under `/__abide/chunk/`. Every
    // name embeds a content hash, so the response is immutable + long-cacheable. renderDocument injects
    // `<script type="module" src="/__abide/chunk/<loader>-<hash>.js">` (the loader lazily imports the
    // matched route's chunk); the stylesheet is linked only when the app bundled CSS.
    if (url.pathname.startsWith('/__abide/chunk/')) {
        const method = scope.request.method.toUpperCase()
        if (method !== 'GET' && method !== 'HEAD')
            return error(405, `Method not allowed: ${method}`, { headers: { allow: 'GET, HEAD' } })
        const name = url.pathname.slice('/__abide/chunk/'.length)
        const build = await clientBuildFor(config)
        const content = build.files.get(name)
        if (content === undefined) return error(404, `Not found: ${url.pathname}`)
        const contentType = name.endsWith('.css')
            ? 'text/css; charset=utf-8'
            : 'text/javascript; charset=utf-8'
        return new Response(content, {
            status: 200,
            headers: {
                'content-type': contentType,
                // Content-addressed → the bytes for this URL never change; cache aggressively.
                'cache-control': 'public, max-age=31536000, immutable',
            },
        })
    }

    // MS4: the OpenAPI 3.1 document, derived from the registry. Served by default and reached
    // through the middleware onion (dispatch runs inside it), so the app can gate it with
    // middleware — no framework-default auth (DX8).
    if (url.pathname === '/openapi.json') {
        return json(buildOpenApi(buildRegistry(config)))
    }

    // MS2: the MCP server (JSON-RPC 2.0 over HTTP POST), derived from the registry. Like OpenAPI it
    // is reached through the middleware onion so the app can gate it — no framework-default auth
    // (MS2.5/DX8).
    if (url.pathname === '/__abide/mcp') {
        return handleMcp(scope.request, config)
    }

    if (scope.route.kind !== 'rpc') {
        // M5b nav page SSR (C6/C6-nav). GET/HEAD only; match the pathname against page patterns
        // (`/users/[id]`), extracting route params so route().params.id works during SSR. Runs inside
        // the request scope + middleware onion (dispatch is the chain terminal), so a short-circuiting
        // middleware blocks the page like any other request.
        const pages = config.pages ?? {}
        const method = scope.request.method.toUpperCase()
        const match = matchRoute(Object.keys(pages), url.pathname)
        if (match !== null && (method === 'GET' || method === 'HEAD')) {
            log.channel('abide:router').trace(
                `page ${match.pattern}${scope.route.navigating ? ' (soft-nav)' : ''}`,
            )
            // Set the matched pattern as the route name and its extracted params before rendering.
            scope.route.name = match.pattern
            scope.route.params = match.params
            const source = pages[match.pattern]
            if (source === undefined) {
                // Unreachable: match.pattern came from Object.keys(pages), so it is always a live key.
                throw new Error(`Matched page pattern has no source: ${match.pattern}`)
            }
            // TODO #7: an uncaught render error (a page/layout that throws with no `{#try}` boundary around
            // it) returns a controlled 500 rather than leaking Bun's default handler. A layout that WANTS to
            // contain an inner-page error still opts in by wrapping `{children()}` in `{#try}{:catch}`.
            try {
                // C6-nav soft-nav: an `Abide-Nav` header requests the inner page (not the full document),
                // STREAMED as a JSONL frame stream (streaming-ssr-plan.md PR4) — shell → out-of-order patches →
                // seed — so a slow read shows the shell then streams in, same as first load. `renderPage(…,
                // true)` awaits blocking reads (a throw still 500s below) and returns the SHELL. Vary on the
                // header so caches key first-load vs soft-nav.
                if (isSoftNav(scope.request)) {
                    // C6.2: how many outer layouts the client is KEEPING (shared with the route it sent in
                    // `Abide-Nav`). Render only the diverging suffix; the client grafts + claims it into the
                    // innermost kept layout's outlet. 0 (no shared layout / unknown origin) renders full.
                    const fromPath = scope.request.headers.get('abide-nav')
                    const fromMatch =
                        fromPath !== null ? matchRoute(Object.keys(pages), fromPath) : null
                    const sharedLevels =
                        fromMatch !== null
                            ? sharedLayoutDepth(
                                  fromMatch.pattern,
                                  match.pattern,
                                  config.layouts ?? {},
                              )
                            : 0
                    const shell = await renderPage(
                        source,
                        config,
                        match.pattern,
                        true,
                        sharedLevels,
                    )
                    const body = streamSoftNav(
                        shell,
                        getContext(),
                        config,
                        url.pathname + url.search,
                        sharedLevels,
                    )
                    return new Response(body, {
                        status: 200,
                        headers: {
                            'content-type': 'application/jsonl',
                            vary: 'Abide-Nav',
                        },
                    })
                }

                // First load = full SSR document (C6.4), STREAMED (streaming-ssr-plan.md PR2): `renderPage(…,
                // true)` awaits blocking reads (a throw here still returns a controlled 500 below) and returns
                // the SHELL; `streamPageDocument` flushes head → shell → out-of-order patches → seed+tail.
                const shell = await renderPage(source, config, match.pattern, true)
                // Boot from the content-hashed loader entry; link the client stylesheet only when the app
                // actually bundled CSS (TODO #6/#20). Both URLs are immutable + content-addressed.
                const build = await clientBuildFor(config)
                const chunk = build.chunkByPattern.get(match.pattern)
                const body = streamPageDocument(shell, getContext(), config, {
                    devReloadScript: config.devReloadScript,
                    clientHref: `/__abide/chunk/${build.entry}`,
                    cssHref:
                        build.cssFile !== undefined ? `/__abide/chunk/${build.cssFile}` : undefined,
                    preloadHref: chunk !== undefined ? `/__abide/chunk/${chunk}` : undefined,
                })
                return new Response(body, {
                    status: 200,
                    headers: { 'content-type': 'text/html; charset=utf-8' },
                })
            } catch (caught) {
                log.channel('abide:router').error(
                    `page render failed for "${match.pattern}":`,
                    caught,
                )
                return error(500, 'Page render failed.')
            }
        }
        return error(404, `Not found: ${url.pathname}`)
    }

    const route = routes[scope.route.name]
    if (route === undefined) {
        return error(404, `Unknown rpc: ${scope.route.name}`)
    }

    const meta = route.__rpc
    log.channel('abide:rpc').trace(`dispatch ${meta.method} ${scope.route.name}`)
    let args: unknown
    // A mutation carrying a `multipart/form-data` body is a file upload (TODO #8): the args are a
    // `FormData` (a `File` rides in it, never in a JSON args object), passed straight to the handler.
    let isMultipart = false
    if (meta.read) {
        const raw = url.searchParams.get('args')
        args = raw !== null ? JSON.parse(raw) : {}
    } else {
        // maxBodySize is enforced on the mutation body up front via Content-Length (multipart streams
        // can lie about length, but a declared oversize is rejected before we buffer it).
        const maxBodySize = meta.options.maxBodySize
        if (maxBodySize !== undefined) {
            const contentLength = scope.request.headers.get('content-length')
            // A finite, oversized declared length is rejected before buffering. A non-numeric or absent
            // length (chunked bodies) can't be trusted, so the real guard is the post-buffer check below.
            const declared = contentLength !== null ? Number(contentLength) : Number.NaN
            if (Number.isFinite(declared) && declared > maxBodySize) {
                return error(413, `Request body exceeds maxBodySize (${maxBodySize} bytes).`)
            }
        }
        const contentType = (scope.request.headers.get('content-type') ?? '').toLowerCase()
        if (contentType.startsWith('multipart/form-data')) {
            isMultipart = true
            args = await scope.request.formData()
        } else {
            const body = await scope.request.text()
            // Enforce maxBodySize against the ACTUAL byte count too — a chunked or length-spoofed body
            // slips past the Content-Length check above, so measure what we actually buffered.
            if (maxBodySize !== undefined && Buffer.byteLength(body) > maxBodySize) {
                return error(413, `Request body exceeds maxBodySize (${maxBodySize} bytes).`)
            }
            args = body.length > 0 ? JSON.parse(body) : {}
        }
    }

    if (isMultipart) {
        // Multipart: the `files` schema validates the uploaded file fields; the JSON `input` schema (TODO
        // #8 follow-up) validates the multipart TEXT fields — a `File` never rides in the JSON args, so we
        // project only the non-File fields and validate that object. The handler still receives the raw
        // `FormData` untouched (validation is a gate only). Both failures narrow to the same
        // ValidationErrorData (422) shape as the JSON input path.
        const filesSchema = meta.options.schemas?.files
        if (filesSchema !== undefined) {
            const issues = validateFiles(args as FormData, filesSchema)
            if (issues.length > 0) return validationError(issues)
        }
        const inputSchema = meta.options.schemas?.input
        if (inputSchema !== undefined) {
            const textArgs = projectFormText(args as FormData, inputSchema)
            const validated = await validateStandard(asStandardSchema(inputSchema), textArgs)
            if (!validated.ok) return validationError(validated.issues)
        }
    } else {
        // M8a input validation — runs on the server for EVERY non-multipart request before the handler.
        // On failure the handler never runs; the caller gets a 422 that narrows to ValidationErrorData.
        const inputSchema = meta.options.schemas?.input
        if (inputSchema !== undefined) {
            const validated = await validateStandard(asStandardSchema(inputSchema), args)
            if (!validated.ok) return validationError(validated.issues)
            args = validated.value
        }
    }

    // Resumable stream replay (replayable-streams.md §5): `?from=<count>` asks to resume a RETAINED stream
    // transcript from chunk `count` (replay `chunks[count..]` then live). If the transcript is gone, we fall
    // through to a fresh run and flag it so the client REPLACES its painted prefix instead of appending.
    let resumeFresh = false
    const fromRaw = meta.read ? url.searchParams.get('from') : null
    if (fromRaw !== null && /^\d+$/.test(fromRaw)) {
        // biome-ignore lint/suspicious/noExplicitAny: existential rpc — the route's concrete Args/T are erased at this dispatch boundary; `unknown` breaks assignability through RpcMeta's invariant Args.
        const resumable = route as Rpc<any, any> & {
            resumeStream(
                a: unknown,
                f: number,
            ): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean }
        }
        const resumed = resumable.resumeStream(args, Number(fromRaw))
        if (!resumed.fresh && resumed.cursor !== undefined) {
            // Re-serve the resumed transcript in the handler's ORIGINAL encoding (sse resumes as sse),
            // mirroring the fresh-run path below.
            const response =
                streamEncodingOf(resumed.cursor) === 'sse'
                    ? sse(resumed.cursor)
                    : jsonl(resumed.cursor)
            response.headers.set('x-abide-stream-resume', 'live')
            return response
        }
        resumeFresh = true
    }

    const result = meta.read
        ? // biome-ignore lint/suspicious/noExplicitAny: existential rpc — concrete Args/T erased at dispatch; `unknown` breaks assignability through RpcMeta's invariant Args.
          await (route as Rpc<any, any>).load(args)
        : // biome-ignore lint/suspicious/noExplicitAny: existential mutation — concrete Args/T erased at dispatch; `unknown` breaks assignability through RpcMeta's invariant Args.
          await (route as Mutation<any, any>)(args)

    // Streams and other raw Responses pass through untouched — nothing to validate or shape.
    if (result instanceof Response) return result

    // A streaming read whose slot holds a ReplayableStream resolves to an AsyncIterable of DECODED chunks
    // (replayable-streams.md §4): the ROUTER applies the transport encoding downstream, once per HTTP
    // consumer. The handler's chosen encoding (jsonl(...)/sse(...)) wins; else `Accept: text/event-stream`
    // selects SSE; else application/jsonl.
    if (isAsyncIterable(result)) {
        const encoding = streamEncodingOf(result)
        const accept = (scope.request.headers.get('accept') ?? '').toLowerCase()
        const useSse =
            encoding === 'sse' || (encoding === undefined && accept.includes('text/event-stream'))
        const response = useSse ? sse(result) : jsonl(result)
        // A `?from=` resume whose transcript was gone → a fresh run from 0; the client must REPLACE.
        if (resumeFresh) response.headers.set('x-abide-stream-resume', 'fresh')
        return response
    }

    // M8a output validation — DEV ONLY contract-drift catch. A mismatch logs loudly but never becomes
    // a client error.
    const outputSchema = meta.options.schemas?.output
    if (outputSchema !== undefined && Bun.env.NODE_ENV !== 'production') {
        const checked = await validateStandard(asStandardSchema(outputSchema), result)
        if (!checked.ok) {
            log.channel('abide:rpc').warn(
                `output schema mismatch for rpc "${scope.route.name}":`,
                checked.issues,
            )
        }
    }

    // Output-shaping (§5.2) — trim the wire result to the declared output schema so undeclared fields
    // (e.g. a `passwordHash` the handler over-returned) never leak. Applied in ALL environments. A
    // Standard Schema or absent schema is not shapeable → the value passes through unchanged.
    return json(shapeToSchema(result, jsonSchemaOf(outputSchema)))
}

export function createApp(config: AppConfig = {}): App {
    const routes = config.routes ?? {}
    const globalMiddleware = config.middleware ?? []
    const sockets = config.sockets ?? {}
    // CO2.4: server bind time — the clock for `/__abide/health`'s `startedAt`/`uptime`. Captured here
    // (not per request) so uptime measures the process, and survives `abide dev`'s in-place config reloads
    // (the router keeps running; createApp is not re-invoked).
    const startedAt = Date.now()

    // §8 broadcast seam (PR2): bind each SHARED read route's transport-free cell `notify` sink to a
    // publish onto its `(rpc,args)` channel. The route NAME is the `config.routes` key — known only
    // here — so createApp is the sole owner of both name and registry; cell/makeRpc stay
    // transport-free. Value-form `amend` carries a `value`; invalidate/refresh do not.
    for (const [name, route] of Object.entries(routes)) {
        const meta = route.__rpc
        if (meta.read && meta.options.cache !== false && meta.options.cache?.shared === true) {
            // biome-ignore lint/suspicious/noExplicitAny: existential rpc — the route's concrete Args/T are erased here; `unknown` breaks assignability through RpcMeta's invariant Args.
            ;(route as Rpc<any, any>).bindBroadcast((verb, args, value): void => {
                const frame: CacheFrame = verb === 'amend' ? { verb, value } : { verb }
                publishCacheFrame(cacheChannelName(name, args), frame)
            })
        }
    }

    // Per-connection subscription state, keyed by the live WS. The connection's identity + request
    // ride on `ws.data` (SocketConnectionData, resolved at upgrade); this map holds only the live
    // subscription iterators so unsub/close can `return()` them.
    const connections = new WeakMap<Bun.ServerWebSocket<SocketConnectionData>, SocketConnection>()

    const server = Bun.serve<SocketConnectionData>({
        port: config.port ?? 0,
        // Bun's default idle timeout (10s) would kill a byte-idle SSE stream (the socket HTTP face)
        // between messages; raise it to Bun's max (255s). Long-lived streams also emit a heartbeat
        // (server/sse.ts) so they survive intermediary proxies with their own idle windows.
        idleTimeout: 255,
        async fetch(request, srv): Promise<Response | undefined> {
            const url = new URL(request.url)

            // Multiplexed socket WS upgrade (sockets.md S3.1). CSWSH-gated before the upgrade. Identity
            // is resolved ONCE here (same cookie/bearer ladder as the HTTP path) and carried on the
            // connection so `@rpc:` cache-channel joins can re-authorize against it per subscribe (§2.3).
            if (url.pathname === '/__abide/sockets') {
                if (!socketOriginAllowed(request)) {
                    return applyResponseHeaders(
                        error(403, 'CSWSH: WebSocket Origin does not match APP_URL.'),
                    )
                }
                const connData: SocketConnectionData = {
                    request,
                    identity: await resolveIdentity(request),
                }
                if (srv.upgrade(request, { data: connData })) return undefined
                return applyResponseHeaders(error(426, 'Expected a WebSocket upgrade request.'))
            }
            // Per-socket HTTP face (sockets.md S3.2).
            if (url.pathname.startsWith('/__abide/sockets/')) {
                return applyResponseHeaders(await socketHttpFace(request, url, sockets))
            }

            const info = routeInfo(url)
            const route: RouteInfo = {
                kind: info.kind,
                name: info.name,
                params: {},
                url,
                navigating: false,
            }
            // CO2.3: propagate an incoming, well-formed traceparent so a browser→server(→server) chain
            // shares one trace id; otherwise leave it unset and let the first trace() call generate one.
            const incomingTrace = request.headers.get('traceparent')
            const propagatedTrace =
                incomingTrace !== null && TRACEPARENT_PATTERN.test(incomingTrace)
                    ? incomingTrace
                    : undefined
            // Identity resolution can throw (a malformed/tampered token that fails to unseal). Degrade
            // to an anonymous principal so the request still gets a scope, and defer the error into the
            // in-scope try below so onError sees it (rather than escaping as a bare 500 before scope).
            let identity: Principal
            let scopeError: unknown
            try {
                identity = await resolveIdentity(request)
            } catch (caught) {
                identity = anonymousPrincipal()
                scopeError = caught
            }
            const scope: RequestScope = {
                request,
                cookies: new Bun.CookieMap(request.headers.get('cookie') ?? ''),
                identity,
                identityStateless: isMachineBearer(request),
                bag: {},
                route,
                // The WS-data generic (SocketConnectionData) is a socket-transport concern only; the
                // public server()/scope.server surface stays `Bun.Server<undefined>` (unchanged API).
                server: srv as unknown as Bun.Server<undefined>,
                cache: new Map<string, unknown>(),
                ...(propagatedTrace !== undefined ? { traceparent: propagatedTrace } : {}),
            }

            const matched = info.kind === 'rpc' ? routes[info.name] : undefined
            const cors =
                matched !== undefined
                    ? normalizeCrossOrigin(matched.__rpc.options.crossOrigin)
                    : undefined
            // CORS preflight: answer an OPTIONS to an RPC before the middleware onion. A crossOrigin-less
            // RPC has no CORS policy, so preflight is simply an unsupported method (405 + Allow).
            if (request.method.toUpperCase() === 'OPTIONS' && info.kind === 'rpc') {
                return applyResponseHeaders(
                    cors !== undefined
                        ? preflightResponse(cors, request)
                        : error(405, 'Method not allowed: OPTIONS', {
                              headers: { allow: 'GET, HEAD, POST, PUT, PATCH, DELETE' },
                          }),
                )
            }
            const rpcMiddleware = matched?.__rpc.options.middleware ?? []
            const chain = compose([...globalMiddleware, ...rpcMiddleware], () =>
                dispatch(scope, config, startedAt),
            )

            // Translate a middleware short-circuit redirect into a soft-nav `{ redirect }` envelope (the
            // raw 3xx would be opaque to a fetch soft-nav), then stamp the identity cookie, CORS, and
            // trace headers. Runs for BOTH the normal response and an onError response — a throw here
            // (gap: post-dispatch stamping) routes to onError via the outer catch.
            const finalize = async (response: Response): Promise<Response> => {
                if (info.kind === 'nav' && isSoftNav(request) && isRedirectResponse(response)) {
                    response = json(
                        { redirect: response.headers.get('location') ?? '', seed: {} },
                        { headers: { vary: 'Abide-Nav' } },
                    )
                }
                await applyIdentityCookie(scope, response)
                if (cors !== undefined) applyCors(cors, request, response)
                if (scope.traceparent !== undefined) {
                    response.headers.set('traceparent', scope.traceparent)
                    response.headers.set('traceresponse', scope.traceparent)
                }
                return response
            }

            return runInScope(scope, async () => {
                // The whole request lifecycle — CSRF gate, dispatch, and post-dispatch stamping — runs
                // inside one try so ANY throw is routed to onError in request scope (not just a throw
                // from the middleware/dispatch chain). A deferred identity-resolution failure surfaces
                // here too. The onError response is itself finalized (stamped); if THAT stamping throws,
                // the response is returned bare rather than recursing.
                let response: Response
                try {
                    if (scopeError !== undefined) throw scopeError
                    // AU8 CSRF gate runs before the middleware onion — a rejected mutation never
                    // dispatches and gets no identity cookie. A crossOrigin-allowed origin is exempt.
                    const rejected = csrfReject(request, cors)
                    if (rejected !== undefined) return applyResponseHeaders(rejected)
                    response = await finalize(await chain())
                } catch (caught) {
                    response = await handleUncaught(caught, config)
                    try {
                        response = await finalize(response)
                    } catch (finalizeError) {
                        log.channel('abide:router').error(
                            'failed to finalize error response:',
                            finalizeError,
                        )
                    }
                }
                return applyResponseHeaders(response)
            }) as Promise<Response>
        },
        websocket: {
            open(ws): void {
                connections.set(ws, { subscriptions: new Map() })
            },
            message(ws, raw): void {
                // `args` is only meaningful for an `@rpc:` cache channel (the raw args that must NAME the
                // channel — the args-spoof defense); it is ignored for bare user-socket subscriptions.
                let frame: {
                    t?: unknown
                    name?: unknown
                    args?: unknown
                    msg?: unknown
                    replay?: unknown
                }
                try {
                    frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
                } catch {
                    return
                }
                if (frame === null || typeof frame !== 'object') return
                const connection = connections.get(ws)
                if (connection === undefined) return
                if (frame.t === 'sub')
                    wsSubscribe(
                        ws,
                        connection,
                        frame.name,
                        frame.args,
                        frame.replay,
                        sockets,
                        config,
                    )
                else if (frame.t === 'unsub') wsUnsubscribe(connection, frame.name)
                else if (frame.t === 'pub') void wsPublish(frame.name, frame.msg, sockets)
            },
            close(ws): void {
                const connection = connections.get(ws)
                if (connection === undefined) return
                for (const iterator of connection.subscriptions.values()) {
                    void iterator.return?.()
                }
                connection.subscriptions.clear()
                connections.delete(ws)
            },
        },
    })

    const origin = `http://localhost:${server.port}`
    return {
        // Public App surface keeps `Bun.Server<undefined>`; the WS-data generic is internal (see above).
        server: server as unknown as Bun.Server<undefined>,
        origin,
        async stop(): Promise<void> {
            await server.stop(true)
        },
    }
}
