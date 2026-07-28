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
// their args from the `__abide_args` query blob (or flat query params) and go through the
// cache-backed `load`; mutations take args from the JSON body and call the handler directly. A
// handler that already returned
// a Response passes through untouched; a bare value is wrapped in `json()`.

import { health } from '../../shared/health.ts'
import { identity } from '../../shared/identity.ts'
import { generateTraceparent } from '../../shared/internal/generateTraceparent.ts'
import { IDENTITY_ROUTE } from '../../shared/internal/IDENTITY_ROUTE.ts'
import { isTimeoutError } from '../../shared/internal/isTimeoutError.ts'
import { asStandardSchema } from '../../shared/internal/jsonSchema.ts'
import { LOGS_ROUTE } from '../../shared/internal/LOGS_ROUTE.ts'
import { logFeed } from '../../shared/internal/logFeed.ts'
import { MUX_UPSTREAM } from '../../shared/internal/MUX_UPSTREAM.ts'
import { matchRoute } from '../../shared/internal/matchRoute.ts'
import {
    type MemoFrame,
    memoChannelHub,
    memoChannelName,
    publishMemoFrame,
} from '../../shared/internal/memoChannels.ts'
import type { MuxDownstream } from '../../shared/internal/muxDownstream.ts'
import { positiveEnvBytes } from '../../shared/internal/positiveEnvBytes.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { reactiveScope } from '../../shared/internal/reactiveScope.ts'
import { streamEncodingOf } from '../../shared/internal/responseSource.ts'
import { jsonSchemaOf, shapeToSchema } from '../../shared/internal/shapeToSchema.ts'
import { subscriptionKey } from '../../shared/internal/subscriptionKey.ts'
import { TRACEPARENT_PATTERN } from '../../shared/internal/TRACEPARENT_PATTERN.ts'
import { log } from '../../shared/log.ts'
import { validateStandard } from '../../shared/StandardSchema.ts'
import { validationError } from '../../shared/ValidationErrorData.ts'
import { error } from '../error.ts'
import { json } from '../json.ts'
import { jsonl } from '../jsonl.ts'
import { clientPublishAllowed, type ErasedSocket } from '../socket.ts'
import { sse } from '../sse.ts'
import { applyResponseCompression } from './applyResponseCompression.ts'
import { applyResponseHeaders } from './applyResponseHeaders.ts'
import {
    clearIdentityCookieHeader,
    identityCookieHeader,
    identityCookieIsDue,
    resolveIdentity,
    resolveIdentityDetailed,
    unrecognizedNodeEnv,
} from './auth.ts'
import {
    authorizeChannelJoin,
    authorizeSocketJoin,
    authorizeTagJoin,
    isMemoChannel,
    isTagChannel,
    type SocketConnectionData,
} from './channelAuth.ts'
import { type ClientBuild, clientBuildFor } from './clientBundle.ts'
import { compressionMode } from './compressionMode.ts'
import {
    applyCors,
    corsAllowOrigin,
    type NormalizedCors,
    normalizeCrossOrigin,
    preflightResponse,
} from './cors.ts'
import { decodeQueryArgs } from './decodeQueryArgs.ts'
import { provideDefaultAgentSurface } from './defaultAgentSurface.ts'
import { isProd } from './isProd.ts'
import { sharedLayoutDepth } from './layouts.ts'
import { logFeedSettings } from './logFeedSettings.ts'
import { logsRoute } from './logsRoute.ts'
import type { Mutation, Rpc, RpcMeta, StreamRead } from './makeRpc.ts'
import { handleMcp } from './mcp.ts'
import { compose, type Middleware } from './middleware.ts'
import { negotiateEncoding } from './negotiateEncoding.ts'
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
} from './requestScope.ts'
import { rpcTools } from './rpcTools.ts'
import { servePublicFile } from './servePublicFile.ts'
import { staticAssetType } from './staticAssetType.ts'
import { validateFiles } from './validateFiles.ts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// The wire form of a tripped run deadline (ADR 0028 D7). Built through `error.typed` so the body carries
// the name the client narrows on, rather than a hand-rolled shape that would drift from every other
// typed error.
const TIMEOUT_RESPONSE = error.typed('TimeoutError', 504)

// One config's page-pattern list, derived once. `matchRoute` needs the full pattern array on every
// nav — twice on a soft-nav, which also matches the `Abide-Nav` origin path — and an app's pages are
// fixed for its lifetime, so rebuilding it with `Object.keys` per request is pure allocation. Weakly
// keyed on the config so a dev-server config swap simply re-derives.
const PAGE_PATTERNS = new WeakMap<AppConfig, string[]>()

function pagePatternsOf(config: AppConfig, pages: Record<string, string>): string[] {
    let patterns = PAGE_PATTERNS.get(config)
    if (patterns === undefined) {
        patterns = Object.keys(pages)
        PAGE_PATTERNS.set(config, patterns)
    }
    return patterns
}

// A streaming read result is an AsyncIterable of decoded chunks (a ReplayableStream `consume()` cursor);
// the router transport-encodes it (jsonl/sse). A plain value/object is not async-iterable.
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
    )
}

// Content-addressed client assets. The one route class that is NOT traced: it is a static byte
// response with no handler, no identity, and an immutable long-cache — minting a trace id per chunk
// fetch would spend entropy and two response headers on something no span will ever join, and the
// immutable response is shared across users, so a per-request header on it is a lie. A production
// build DOES vary it on `Accept-Encoding` (precompressed brotli/gzip), which is not a per-request
// header in that sense: it selects among fixed representations of the same content-addressed bytes and
// stays identity-free, so the response is still shared across every client that negotiates alike.
const CHUNK_PREFIX = '/__abide/chunk/'

// Does the LAST path segment carry an extension? The cheap synchronous gate in front of the
// `src/ui/public/**` lookup — a page route (`/memo`, `/users/7`) has none and never reaches the
// filesystem. A leading dot does not count (`/.well-known` is a directory, not a file).
//
// Deliberately NOT `staticAssetType(pathname) !== undefined`, which decides the same question: this
// runs on EVERY request, and a predicate that is two `indexOf`s beats one that also hashes an
// extension into a table and allocates a result for the file case. It must stay in step with that
// function's rule, which is the authority — if what counts as an extension changes there, change it
// here too.
function looksLikeFile(pathname: string): boolean {
    const slash = pathname.lastIndexOf('/')
    const dot = pathname.lastIndexOf('.')
    return dot > slash + 1 && dot < pathname.length - 1
}

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

    const appUrl = Bun.env.APP_URL
    if (appUrl !== undefined && appUrl.length > 0) {
        // AU8.3 Origin/Referer check. Prefer the unforgeable `Origin`; fall back to `Referer` when a
        // browser omitted `Origin` on the mutation (older browsers / some same-origin navs). When NEITHER
        // is present we ALLOW — the non-simple-shape gate above is the primary CSRF defense, and a
        // `no-referrer` policy must not break a legitimate request. `Referer` is a full URL; `Origin` is
        // already an origin — `new URL(x).origin` normalizes both to a comparable origin.
        const claimed = request.headers.get('origin') ?? request.headers.get('referer')
        if (claimed !== null) {
            let claimedOrigin: string
            let appHost: string
            try {
                claimedOrigin = new URL(claimed).origin
                appHost = new URL(appUrl).origin
            } catch {
                return error(403, 'CSRF: could not verify request Origin/Referer against APP_URL.')
            }
            // A mismatch is rejected UNLESS this RPC opted into cross-origin access for it (the
            // `crossOrigin` allowlist) — CORS is the sanctioned way to admit a foreign origin.
            if (
                claimedOrigin !== appHost &&
                corsAllowOrigin(cors ?? NO_CORS, claimedOrigin) === undefined
            ) {
                return error(403, 'CSRF: request Origin/Referer does not match APP_URL.')
            }
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

// The `Allow` header for a route, derived from the route's DECLARED verb instead of being restated
// as a literal per call site (there were five independent ones, none agreeing). HEAD rides with GET
// because the router DERIVES it rather than accepting a declaration (ADR 0027 D6). An unmatched name
// has no declared verb to report, so it names the full set.
function allowHeaderFor(route: Route | undefined): string {
    const meta = route?.__rpc
    if (meta === undefined) return 'GET, HEAD, POST, PUT, PATCH, DELETE'
    return meta.read ? `${meta.method}, HEAD` : meta.method
}

// After dispatch, refresh (or clear) the rolling abide-identity cookie for browser identities.
// Machine-bearer callers are stateless and get no cookie, even if identity.set() ran (AU6.3).
// A response a SHARED cache may store must not carry a per-user `set-cookie` — the next client through
// that cache would be handed someone else's identity. The content-addressed `/__abide/chunk/` assets are
// the case in the box today (they declare `public, max-age=31536000, immutable`), and stamping a cookie
// on them also defeated the caching they asked for.
function isPubliclyCacheable(response: Response): boolean {
    const cacheControl = response.headers.get('cache-control')
    if (cacheControl === null) return false
    return /(^|,)\s*public\s*(,|$)/.test(cacheControl.toLowerCase())
}

async function applyIdentityCookie(scope: RequestScope, response: Response): Promise<void> {
    if (scope.identityStateless) return
    if (isPubliclyCacheable(response)) {
        // Fail safe: never leak an identity into a shared cache. A login landing on a response the app
        // marked publicly cacheable is an app bug, so say so rather than dropping it silently.
        if (scope.identityDirty === true || scope.identityCleared === true) {
            log.channel('abide:identity').warn(
                'identity.set()/clear() ran on a publicly cacheable response — the abide-identity cookie was NOT written, because a shared cache would serve it to another client. Remove `Cache-Control: public` from this route.',
            )
        }
        return
    }
    if (scope.identityCleared) {
        response.headers.append('set-cookie', clearIdentityCookieHeader())
        return
    }
    // The rolling cookie only needs rewriting when it changed or is far enough through its life —
    // re-sealing every response cost an AES-GCM encrypt per reply to restate what the client already holds.
    if (scope.identityDirty !== true && !identityCookieIsDue(scope.identityExpiresAt)) return
    response.headers.append('set-cookie', await identityCookieHeader(scope.identity))
}

// Last-resort handler for an error that escaped the middleware/dispatch chain (a genuine bug — typed
// error/redirect responses are returned, not thrown). Runs in request scope, so the app's `onError`
// can read request()/route()/identity() ambiently. The hook may return a Response to shape the client
// reply; anything else (or a throwing hook) falls back to a generic 500 that never leaks the detail.
async function handleUncaught(caught: unknown, config: AppConfig): Promise<Response> {
    // A tripped run deadline is not a bug in the app, so it is answered before `onError` and never
    // reaches the generic 500 (ADR 0028 D7). It leaves as a TYPED error so the two sides of an
    // isomorphic call agree: the browser proxy's `fn.isError(e, 'TimeoutError')` narrows on the body's
    // `name`, which is the same value `AbortSignal.timeout` gives a caller that aborted locally.
    //
    // 504, not 408 — 408 says the CLIENT was slow sending its request; here the server was slow
    // producing, which is what a gateway timeout means.
    if (isTimeoutError(caught)) {
        log.channel('abide:rpc').warn('run exceeded its timeout:', caught)
        return TIMEOUT_RESPONSE()
    }
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
    // The project root, set by the file-based loader (`loadApp`). Two consumers, both filesystem-relative:
    // `src/ui/public/**` static serving, and the client bundle's `external` list (which is derived from
    // that same directory). Absent for hand-built configs — those have no project on disk, so both
    // features simply stay off rather than guessing a cwd.
    dir?: string
    // BP1.7: `src/ui/public/**` EMBEDDED in a `abide compile` executable — request path (`/favicon.ico`)
    // → the path Bun's asset embedding gave the file inside the binary. Set only by a compiled binary,
    // where `dir` names a source tree that isn't on the machine; when present it REPLACES the
    // filesystem lookup (a standalone binary answers only for what it carries).
    publicFiles?: Record<string, string>
    routes?: Record<string, Route>
    middleware?: Middleware[]
    sockets?: Record<string, ErasedSocket>
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
// holds, keyed by `subscriptionKey(name, args)` → the draining async iterator (so unsub/close can
// `return()` it). The key folds in the room so one connection can hold several rooms of one socket.
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

// Drain one socket's iterator into the WS, framing each message `{ name, args?, msg }`. `subKey` guards
// the subscription slot (roomed sockets share a `name`); `args` (the room, or `undefined`) is echoed so
// the client routes to the right per-room subscription. Ends when the iterator completes, the client
// unsubscribed (replaced/removed in the map), or the WS closed.
async function pumpSocketToWs(
    ws: Bun.ServerWebSocket<SocketConnectionData>,
    connection: SocketConnection,
    subKey: string,
    name: string,
    args: unknown,
    iterator: AsyncIterator<unknown>,
): Promise<void> {
    try {
        while (true) {
            const result = await iterator.next()
            if (result.done === true) break
            if (connection.subscriptions.get(subKey) !== iterator) break
            if (ws.readyState !== 1) break
            const frame: MuxDownstream =
                args === undefined ? { name, msg: result.value } : { name, args, msg: result.value }
            ws.send(JSON.stringify(frame))
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
    sockets: Record<string, ErasedSocket>,
    config: AppConfig,
): void {
    if (typeof name !== 'string') return
    // `@rpc:` cache-invalidation channel — the S4.4 exception: per-subscribe authorization against
    // the connection's identity, re-running the target rpc's read gate for the presented args. Cache
    // channels keep SILENT-DENY (their TTL self-heals a missed frame); user sockets do not (below).
    if (isMemoChannel(name)) {
        if (connection.subscriptions.has(name)) return
        void subscribeMemoChannel(ws, connection, name, args, config)
        return
    }
    // `@tag:` cache-tag channel. Same silent-deny class as `@rpc:` (a missed frame self-heals on the
    // next read), but authorized by DECLARATION rather than by re-running a read gate — the frame
    // carries a verb and no payload, so there are no per-args rows to authorize. See `authorizeTagJoin`.
    if (isTagChannel(name)) {
        if (connection.subscriptions.has(name)) return
        subscribeTagChannel(ws, connection, name, config)
        return
    }
    void subscribeUserSocket(ws, connection, name, args, replay, sockets, config)
}

// Authorize + join a USER SOCKET room (ADR 0023 rooms). `args` is the room (undefined = the void
// socket). Unlike cache channels, user sockets are OFF silent-deny (client-sockets.md CS2): an unknown
// socket OR a denied room gets a terminal sub-error frame (→ client `error()`); a successful join gets a
// sub-ack (→ clears client `pending()`). Per-room auth re-runs the socket's `middleware` for the room
// args (`authorizeSocketJoin`); a middleware-less socket is connect-authed. `replay: false` is the
// hydration join — SSR already painted the backlog (CS5).
async function subscribeUserSocket(
    ws: Bun.ServerWebSocket<SocketConnectionData>,
    connection: SocketConnection,
    name: string,
    args: unknown,
    replay: unknown,
    sockets: Record<string, ErasedSocket>,
    config: AppConfig,
): Promise<void> {
    const key = subscriptionKey(name, args)
    if (connection.subscriptions.has(key)) return
    const sock = sockets[name]
    if (sock === undefined) {
        log.channel('abide:socket').warn(`subscribe rejected — unknown socket: ${name}`)
        ws.send(
            JSON.stringify({
                name,
                error: { message: `unknown socket: ${name}` },
            } satisfies MuxDownstream),
        )
        return
    }
    const allowed = await authorizeSocketJoin(name, sock, args, ws.data, config)
    if (!allowed) {
        log.channel('abide:socket').warn(`subscribe denied — room not authorized: ${name}`)
        ws.send(
            JSON.stringify({
                name,
                args,
                error: { message: 'not authorized' },
            } satisfies MuxDownstream),
        )
        return
    }
    // Re-check across the await: a racing unsub/dup-sub for the same room, or a closed socket, must
    // not leave a dangling join.
    if (connection.subscriptions.has(key)) return
    if (ws.readyState !== 1) return
    const iterator = sock.__socket.subscribe(args, replay !== false)
    connection.subscriptions.set(key, iterator)
    const ack: MuxDownstream = args === undefined ? { name, ok: true } : { name, args, ok: true }
    ws.send(JSON.stringify(ack))
    log.channel('abide:socket').info(`subscribe ${name} replay=${replay !== false}`)
    void pumpSocketToWs(ws, connection, key, name, args, iterator)
}

// Authorize + join an `@rpc:` cache channel. On DENY do nothing (silent — matches the existing
// ignore-unknown-name contract; a client learns nothing about whether the channel exists or why
// it was refused). Re-runs `authorizeChannelJoin` on EVERY subscribe (never cached on the
// connection) so per-args row-level middleware authz is enforced for each join.
async function subscribeMemoChannel(
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
    const iterator = memoChannelHub(name).subscribe()
    connection.subscriptions.set(name, iterator)
    log.channel('abide:socket').trace(`cache-channel join: ${name}`)
    void pumpSocketToWs(ws, connection, name, name, undefined, iterator)
}

// Join an `@tag:` cache-tag channel. Synchronous — the declaration gate is a registry lookup, with no
// middleware chain to await, so there is no across-the-await re-check to make.
function subscribeTagChannel(
    ws: Bun.ServerWebSocket<SocketConnectionData>,
    connection: SocketConnection,
    name: string,
    config: AppConfig,
): void {
    if (!authorizeTagJoin(name, config)) {
        log.channel('abide:socket').trace(`tag-channel join denied: ${name}`)
        return
    }
    if (ws.readyState !== 1) return
    const iterator = memoChannelHub(name).subscribe()
    connection.subscriptions.set(name, iterator)
    log.channel('abide:socket').trace(`tag-channel join: ${name}`)
    void pumpSocketToWs(ws, connection, name, name, undefined, iterator)
}

function wsUnsubscribe(connection: SocketConnection, name: unknown, args: unknown): void {
    if (typeof name !== 'string') return
    const key = subscriptionKey(name, args)
    const iterator = connection.subscriptions.get(key)
    if (iterator === undefined) return
    connection.subscriptions.delete(key)
    void iterator.return?.()
}

// Client publish over the WS into room `args` (undefined = the void socket). Ignored unless the socket
// opted into `clientPublish`; a roomed publish is ALSO per-room authorized (`authorizeSocketJoin`) — the
// same gate as subscribe, so a client cannot publish into a room it may not join. Routed through the
// socket's `ingressPublish` so a mediating `handler` can transform / drop / reject.
async function wsPublish(
    ws: Bun.ServerWebSocket<SocketConnectionData>,
    name: unknown,
    args: unknown,
    message: unknown,
    sockets: Record<string, ErasedSocket>,
    config: AppConfig,
): Promise<void> {
    if (typeof name !== 'string') return
    const sock = sockets[name]
    if (sock === undefined) return
    if (!clientPublishAllowed(sock.__socket.options.clientPublish)) return
    if (!(await authorizeSocketJoin(name, sock, args, ws.data, config))) {
        log.channel('abide:socket').warn(`publish denied — room not authorized: ${name}`)
        return
    }
    try {
        await sock.__socket.ingressPublish(args, message)
    } catch {
        // A handler reject is surfaced to WS publishers as a silent drop (no request/response pair).
    }
}

// The per-socket HTTP face: GET/HEAD → SSE subscribe, POST → publish (respecting clientPublish).
//
// Reached from `dispatch`, INSIDE the request scope — so it runs the middleware onion (global + this
// socket's own), the CSRF gate, and the response stamping, exactly like an rpc. It used to return
// straight out of `Bun.serve.fetch` ~110 lines above all of that, which meant a state-changing,
// cookie-authenticated POST ran no middleware and no CSRF check: `export const middleware = [auth]`
// did not protect a socket publish, and the reply carried no identity cookie and no traceparent.
async function socketHttpFace(
    request: Request,
    name: string,
    sockets: Record<string, ErasedSocket>,
): Promise<Response> {
    const sock = sockets[name]
    if (sock === undefined) return error(404, `Unknown socket: ${name}`)

    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
        return sse(sock)
    }
    if (method === 'POST') {
        if (!clientPublishAllowed(sock.__socket.options.clientPublish)) {
            return error(403, `socket: client publish is disabled for ${name}.`)
        }
        const body = await request.text()
        const message = body.length > 0 ? JSON.parse(body) : undefined
        try {
            // The WS-less HTTP face operates on the void room (no room selector in the URL).
            await sock.__socket.ingressPublish(undefined, message)
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

function routeInfo(url: URL, method: string): { kind: RouteKind; name: string } {
    const pathname = url.pathname
    // RPC transport lives under the framework namespace (`/__abide/rpc/<name>`), alongside
    // `/__abide/sockets`, `/__abide/health`, and `/__abide/mcp` — so the `/rpc/*` URL space is free
    // for app pages. Checked after the exact `/__abide/*` endpoints in `dispatch`, none of which
    // share this prefix.
    if (pathname.startsWith('/__abide/rpc/')) {
        return { kind: 'rpc', name: pathname.slice('/__abide/rpc/'.length) }
    }
    // The per-socket HTTP face (sockets.md S3.2). Classified HERE rather than short-circuited in
    // `fetch`, so it reaches the same policy stack every other route does. Subscribe and publish are
    // distinct kinds — both already declared on `RouteKind`, and unused until now precisely because
    // this path never built a scope for `route()` to report.
    if (pathname.startsWith(SOCKET_FACE_PREFIX)) {
        const name = decodeURIComponent(pathname.slice(SOCKET_FACE_PREFIX.length))
        const reading = method === 'GET' || method === 'HEAD'
        return { kind: reading ? 'socket-subscribe' : 'socket-publish', name }
    }
    return { kind: 'nav', name: pathname }
}

// The WS-less per-socket face. The bare `/__abide/sockets` (no trailing slash) is the WS mux upgrade
// and is NOT this — an upgrade cannot travel through the response pipeline.
const SOCKET_FACE_PREFIX = '/__abide/sockets/'

async function dispatch(
    scope: RequestScope,
    config: AppConfig,
    startedAt: number,
): Promise<Response> {
    const routes = config.routes ?? {}
    const url = scope.route.url

    // AU3 / the isomorphic `identity()`: the caller's OWN resolved principal — what the ladder already
    // decided this request is, handed back verbatim. It discloses nothing they do not hold (their next
    // request IS this identity), which is what makes it safe to answer without ceremony; a browser's
    // `identity.refresh()` and a compiled binary's `identity` subcommand both read it. Inside the
    // middleware chain like every other route, so an app that gates its surface gates this too.
    if (url.pathname === IDENTITY_ROUTE) {
        return Response.json(identity())
    }

    // The log feed (opt-in; 404 when this deployment did not enable it). Inside the middleware chain
    // like `/__abide/identity` above — an app that gates its surface gates its logs too, which is the
    // whole authorization story for this route.
    if (url.pathname === LOGS_ROUTE) {
        const method = scope.request.method.toUpperCase()
        if (method !== 'GET' && method !== 'HEAD')
            return error(405, `Method not allowed: ${method}`, { headers: { allow: 'GET, HEAD' } })
        return logsRoute(url, scope.request.signal)
    }

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
    if (url.pathname.startsWith(CHUNK_PREFIX)) {
        const method = scope.request.method.toUpperCase()
        if (method !== 'GET' && method !== 'HEAD')
            return error(405, `Method not allowed: ${method}`, { headers: { allow: 'GET, HEAD' } })
        const name = url.pathname.slice(CHUNK_PREFIX.length)
        const build = await clientBuildFor(config)
        const asset = build.files.get(name)
        if (asset === undefined) return error(404, `Not found: ${url.pathname}`)
        const contentType = staticAssetType(name)?.type ?? 'text/javascript; charset=utf-8'
        const headers: Record<string, string> = {
            'content-type': contentType,
            // Content-addressed → the bytes for this URL never change; cache aggressively.
            'cache-control': 'public, max-age=31536000, immutable',
        }
        // A production build precompresses this asset; dev serves identity only, and `ABIDE_COMPRESS=off`
        // withholds the variants a build did produce. `Vary` is stamped only when the URL genuinely has
        // more than one representation — an incompressible asset answers identically to every client, so
        // advertising variance would split cache entries for nothing.
        const offered = compressionMode() !== 'off'
        const hasBrotli = offered && asset.brotli !== null
        const hasGzip = offered && asset.gzip !== null
        const encoding = negotiateEncoding(
            scope.request.headers.get('accept-encoding'),
            hasBrotli,
            hasGzip,
        )
        let body = asset.identity
        if (hasBrotli || hasGzip) {
            headers.vary = 'Accept-Encoding'
            if (encoding === 'br' && asset.brotli !== null) {
                headers['content-encoding'] = 'br'
                body = asset.brotli
            } else if (encoding === 'gzip' && asset.gzip !== null) {
                headers['content-encoding'] = 'gzip'
                body = asset.gzip
            }
        }
        // HEAD is GET minus the body, but its `Content-Length` must still describe the representation
        // that a GET would return — so it is stated explicitly rather than left to the empty body.
        if (method === 'HEAD') headers['content-length'] = String(body.byteLength)
        return new Response(method === 'HEAD' ? null : body, { status: 200, headers })
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

    // S3.2: the per-socket HTTP face, in the onion for the same reason OpenAPI and MCP are — the app
    // gates it with middleware. `route()` reports `socket-subscribe`/`socket-publish`, so a middleware
    // can tell a subscribe from a publish. Iterating a socket here does NOT hit the SSR
    // snapshot-then-complete path: that keys off `reactiveScope().rendering`, which only a page render
    // sets, so the SSE subscribe stays live.
    if (scope.route.kind === 'socket-subscribe' || scope.route.kind === 'socket-publish') {
        return socketHttpFace(scope.request, scope.route.name, config.sockets ?? {})
    }

    // `src/ui/public/**` served at its literal path. Placed AFTER the framework-generated routes (so a
    // file can never shadow `/openapi.json` or `/__abide/*`) and BEFORE page SSR (so an app can serve a
    // real `/favicon.ico` without a page pattern intercepting it). Falls through when nothing matches.
    // The `looksLikeFile` guard is SYNCHRONOUS and runs first on purpose: without it every request —
    // every RPC, every page nav — would allocate a promise and take a microtask tick to `await` a lookup
    // that answers "no" for anything without a file extension. A public asset always has one.
    if (
        (config.dir !== undefined || config.publicFiles !== undefined) &&
        looksLikeFile(url.pathname)
    ) {
        const publicResponse = await servePublicFile(
            config.dir,
            url.pathname,
            scope.request,
            config.publicFiles,
        )
        if (publicResponse !== undefined) return publicResponse
    }

    if (scope.route.kind !== 'rpc') {
        // M5b nav page SSR (C6/C6-nav). GET/HEAD only; match the pathname against page patterns
        // (`/users/[id]`), extracting route params so route().params.id works during SSR. Runs inside
        // the request scope + middleware onion (dispatch is the chain terminal), so a short-circuiting
        // middleware blocks the page like any other request.
        const pages = config.pages ?? {}
        const method = scope.request.method.toUpperCase()
        const patterns = pagePatternsOf(config, pages)
        const match = matchRoute(patterns, url.pathname)
        if (match !== null && (method === 'GET' || method === 'HEAD')) {
            log.channel('abide:router').trace(
                `page ${match.pattern}${scope.route.navigating ? ' (soft-nav)' : ''}`,
            )
            // Set the matched pattern as the route name and its extracted params before rendering.
            scope.route.name = match.pattern
            scope.route.params = match.params
            const source = pages[match.pattern]
            if (source === undefined) {
                // Unreachable: match.pattern came from the pages key list, so it is always a live key.
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
                    const fromMatch = fromPath !== null ? matchRoute(patterns, fromPath) : null
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
                        reactiveScope(),
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
                const routeChunks = build.routeChunks.get(match.pattern)
                const body = streamPageDocument(shell, reactiveScope(), config, {
                    devReloadScript: config.devReloadScript,
                    clientHref: `/__abide/chunk/${build.entry}`,
                    bootHrefs: build.bootChunks.map((name) => `${CHUNK_PREFIX}${name}`),
                    cssHref:
                        build.cssFile !== undefined ? `/__abide/chunk/${build.cssFile}` : undefined,
                    preloadHrefs: routeChunks?.map((name) => `${CHUNK_PREFIX}${name}`),
                })
                return new Response(body, {
                    status: 200,
                    headers: {
                        'content-type': 'text/html; charset=utf-8',
                        // Same URL as the soft-nav JSONL response above, differing only by the
                        // `Abide-Nav` request header — so BOTH representations must declare it. Only
                        // the soft-nav half used to, which left a cache free to serve a page fragment
                        // to a first load. `Vary: Cookie` (the identity-scoped default) does not key
                        // these apart; nothing about the cookie differs between them.
                        vary: 'Abide-Nav',
                    },
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
    // The declared verb is ENFORCED, not just advertised. `auth.md` §AU8 grounds the whole
    // SameSite=Lax argument on "mutations are never on GET" — the top-level cross-site GET that Lax
    // still admits carries the identity cookie and skips the CSRF gate (`csrfReject` exempts reads),
    // so a mutation reachable over GET is a CSRF hole no matter what the handler was declared as.
    // HEAD is the one derived verb: it IS GET minus the body (ADR 0027 D6), so it reaches a GET rpc.
    const requestMethod = scope.request.method.toUpperCase()
    if (requestMethod !== meta.method && !(requestMethod === 'HEAD' && meta.method === 'GET')) {
        return error(405, `Method not allowed: ${requestMethod}`, {
            headers: { allow: allowHeaderFor(route) },
        })
    }
    log.channel('abide:rpc').trace(`dispatch ${meta.method} ${scope.route.name}`)
    applyRunDeadlineSignal(scope, meta)
    let args: unknown
    // A mutation carrying a `multipart/form-data` body is a file upload (TODO #8): the args are a
    // `FormData` (a `File` rides in it, never in a JSON args object), passed straight to the handler.
    let isMultipart = false
    if (meta.read) {
        // Reads carry args in the URL two ways: the canonical `__abide_args` JSON blob (what the
        // browser proxy / test app / MCP / channel-auth emit), or FLAT query params (`?key=beta`, the
        // hand-testable form) decoded + schema-coerced when the blob is absent.
        const raw = url.searchParams.get(RPC_QUERY_PARAMS.args)
        args =
            raw !== null
                ? JSON.parse(raw)
                : decodeQueryArgs(url.searchParams, meta.options.schemas?.input)
    } else {
        // maxBodySize is enforced on the mutation body up front via Content-Length (multipart streams
        // can lie about length, but a declared oversize is rejected before we buffer it). The per-RPC
        // option is an OVERRIDE of `ABIDE_MAX_REQUEST_BODY_SIZE` — which was documented in two places
        // and read nowhere, so an rpc that declared no ceiling buffered an unbounded body. Unset, the
        // env read yields Infinity, which is the same "no ceiling" this had before, now stated once.
        const maxBodySize =
            meta.options.maxBodySize ?? positiveEnvBytes('ABIDE_MAX_REQUEST_BODY_SIZE')
        const contentLength = scope.request.headers.get('content-length')
        // A finite, oversized declared length is rejected before buffering. A non-numeric or absent
        // length (chunked bodies) can't be trusted, so the real guard is the post-buffer check below.
        const declared = contentLength !== null ? Number(contentLength) : Number.NaN
        if (Number.isFinite(declared) && declared > maxBodySize) {
            return error(413, `Request body exceeds maxBodySize (${maxBodySize} bytes).`)
        }
        const contentType = (scope.request.headers.get('content-type') ?? '').toLowerCase()
        if (contentType.startsWith('multipart/form-data')) {
            isMultipart = true
            args = await scope.request.formData()
        } else {
            const body = await scope.request.text()
            // Enforce maxBodySize against the ACTUAL byte count too — a chunked or length-spoofed body
            // slips past the Content-Length check above, so measure what we actually buffered.
            if (Buffer.byteLength(body) > maxBodySize) {
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

    // Resumable stream replay (replayable-streams.md §5): `?__abide_from=<count>` asks to resume a RETAINED stream
    // transcript from chunk `count` (replay `chunks[count..]` then live). If the transcript is gone, we fall
    // through to a fresh run and flag it so the client REPLACES its painted prefix instead of appending.
    let resumeFresh = false
    const fromRaw = meta.read ? url.searchParams.get(RPC_QUERY_PARAMS.from) : null
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
          await (route as Rpc<any, any>)(args)
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
        // A `?__abide_from=` resume whose transcript was gone → a fresh run from 0; the client must REPLACE.
        if (resumeFresh) response.headers.set('x-abide-stream-resume', 'fresh')
        return response
    }

    // M8a output validation — DEV ONLY contract-drift catch. A mismatch logs loudly but never becomes
    // a client error.
    const outputSchema = meta.options.schemas?.output
    if (outputSchema !== undefined && !isProd()) {
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

    // Per-route static policy, derived ONCE at boot rather than per request. `crossOrigin` and
    // `middleware` live on an immutable options object, so normalizing the CORS config and merging the
    // global + per-rpc middleware lists on every request re-derived a constant — and the merge also
    // allocated a fresh spread array each time. Only the final `compose` stays per-request: its inner
    // `next` closes over that request's scope.
    const routePolicy = new Map<
        Route,
        { cors: NormalizedCors | undefined; middleware: Middleware[] }
    >()
    for (const routeDef of Object.values(routes)) {
        routePolicy.set(routeDef, {
            cors: normalizeCrossOrigin(routeDef.__rpc.options.crossOrigin),
            middleware: [...globalMiddleware, ...(routeDef.__rpc.options.middleware ?? [])],
        })
    }

    // The socket analog of `routePolicy`. A socket's own `middleware` authorizes its subscribes and
    // publishes (CLAUDE.md: "the socket analog of an rpc's middleware"); the WS join path already runs
    // it via `authorizeSocketJoin`, so without this the HTTP face was the one way in that skipped it.
    // Same boot-time derivation, same reason: the merged list is a constant per socket.
    const socketPolicy = new Map<string, Middleware[]>()
    for (const [socketName, sock] of Object.entries(sockets)) {
        socketPolicy.set(socketName, [
            ...globalMiddleware,
            ...(sock.__socket.options.middleware ?? []),
        ])
    }

    // AU8.3 / CX8.1: the Origin/Referer CSRF check and the CSWSH WebSocket-upgrade gate both key off
    // `APP_URL`. An unset `APP_URL` is legitimate in dev (and for hand-built/test apps), so those gates
    // fall OPEN rather than block — but in production that silently disables two same-origin defenses.
    // Warn ONCE at boot (root channel → always emitted, even without DEBUG) so the omission is loud.
    if (isProd() && (Bun.env.APP_URL === undefined || Bun.env.APP_URL.length === 0)) {
        log.warn(
            'APP_URL is unset in production — the CSRF Origin/Referer check and the CSWSH WebSocket-upgrade gate are DISABLED (both fall open). Set APP_URL to your public origin to enable them.',
        )
    }
    // AU5/AU8: NODE_ENV is the single production gate (Secure cookie, HSTS, the identity-secret fail-fast).
    // A set-but-unrecognized value (`prod`, `staging`, …) is treated as non-production and silently relaxes
    // all three — warn once so a misconfigured deploy is loud rather than insecure-by-typo.
    const badNodeEnv = unrecognizedNodeEnv()
    if (badNodeEnv !== undefined) {
        log.warn(
            `NODE_ENV="${badNodeEnv}" is not recognized — treating as non-production. The Secure cookie flag, HSTS, and the authenticated identity.set() secret requirement are all OFF. Set NODE_ENV=production to enable the production security posture.`,
        )
    }
    // CO2.4: server bind time — the clock for `/__abide/health`'s `startedAt`/`uptime`. Captured here
    // (not per request) so uptime measures the process, and survives `abide dev`'s in-place config reloads
    // (the router keeps running; createApp is not re-invoked).
    const startedAt = Date.now()

    // The log feed is opt-in and enabled HERE — at bind, not on the first subscribe — because its ring
    // must already be filling when someone runs `logs` in response to a problem. `shared/log.ts` reads
    // only a boolean, so the policy (and the env name) lives on this side and a browser bundle carries
    // neither. `abide run` binds no server and so never enables it: there would be no route to read it.
    const logFeedConfig = logFeedSettings()
    if (logFeedConfig.enabled) logFeed.enable(logFeedConfig.capacity)

    // §8 broadcast seam (PR2): bind each SHARED read route's transport-free memo `notify` sink to a
    // publish onto its `(rpc,args)` channel. The route NAME is the `config.routes` key — known only
    // here — so createApp is the sole owner of both name and registry; memo/makeRpc stay
    // transport-free. Value-form `publish` carries a `value`; invalidate/refresh do not.
    for (const [name, route] of Object.entries(routes)) {
        const meta = route.__rpc
        if (meta.read && meta.options.memo !== false && meta.options.memo?.crossRequest === true) {
            // biome-ignore lint/suspicious/noExplicitAny: existential rpc — the route's concrete Args/T are erased here; `unknown` breaks assignability through RpcMeta's invariant Args.
            ;(route as Rpc<any, any>).bindBroadcast((verb, args, value): void => {
                const frame: MemoFrame = verb === 'publish' ? { verb, value } : { verb }
                publishMemoFrame(memoChannelName(name, args), frame)
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

            // ── THE REQUEST PIPELINE ────────────────────────────────────────────────────────────
            // Every response leaves this handler through `exit()`, in this order. The order is
            // load-bearing and the exhaustiveness is the point: before this was written down, each
            // route class was inlined at whatever point in the file its author was reading, and four
            // of them (WS reject, CORS preflight, CSRF reject, first-load document) each acquired a
            // different subset of the stamping — a `traceparent`-less 403, a preflight with no trace,
            // a CSRF rejection with no `Access-Control-Allow-Origin` (so the browser reported an
            // opaque CORS failure instead of the 403 it was handed).
            //
            //   1. mint trace          — every non-asset request, before anything can short-circuit
            //   2. WS upgrade gate     — CSWSH; exits with { trace }
            //   3. classify route      — routeInfo
            //   4. resolve identity    — never throws out; a failure defers into scope for onError
            //   5. build scope
            //   6. CORS preflight      — exits with { trace, cors }
            //   7. enter scope ─┐
            //   8.   CSRF gate  │      — exits with { trace, cors }; NO identity cookie (a rejected
            //   9.   middleware │        mutation never dispatches, so it earns no rolling cookie)
            //  10.   dispatch   │
            //  11.   redirect envelope → identity cookie → CORS → trace   (the full `exit`)
            //  12.   compression       — before header stamping: it appends Accept-Encoding to Vary
            //  13.   baseline headers ─┘
            //
            // Trace is minted FIRST so stages 2 and 6 — which run before the request scope exists —
            // can still stamp it. `reactiveScope().traceparent` is unreachable there; the local is not.
            const incomingTrace = request.headers.get('traceparent')
            const propagatedTrace =
                incomingTrace !== null && TRACEPARENT_PATTERN.test(incomingTrace)
                    ? incomingTrace
                    : url.pathname.startsWith(CHUNK_PREFIX)
                      ? undefined
                      : generateTraceparent()

            // The ONE exit. `identityCookie` and `cors` are the only stages any caller may decline,
            // and each declines for a stated reason at its call site. Trace is never optional — a
            // response that carries no traceparent names no span, which is the silent default this
            // eager mint exists to remove (CO2.3).
            const exit = async (
                response: Response,
                // Both stages are declared `| undefined` rather than optional: every caller states a
                // verdict on each one, so a new exit path cannot skip a stage by simply not
                // mentioning it — which is the failure this pipeline exists to make unrepresentable.
                stages: { scope: RequestScope | undefined; cors: NormalizedCors | undefined },
            ): Promise<Response> => {
                if (stages.scope !== undefined) await applyIdentityCookie(stages.scope, response)
                if (stages.cors !== undefined) applyCors(stages.cors, request, response)
                if (propagatedTrace !== undefined) {
                    response.headers.set('traceparent', propagatedTrace)
                    response.headers.set('traceresponse', propagatedTrace)
                }
                // Compression BEFORE header stamping: it appends `Accept-Encoding` to `Vary`, and the
                // identity-scoped default that follows appends `Cookie` to the same header.
                return applyResponseHeaders(
                    await applyResponseCompression(response, request, url.pathname),
                )
            }

            // Multiplexed socket WS upgrade (sockets.md S3.1). CSWSH-gated before the upgrade. Identity
            // is resolved ONCE here (same cookie/bearer ladder as the HTTP path) and carried on the
            // connection so `@rpc:` cache-channel joins can re-authorize against it per subscribe (§2.3).
            if (url.pathname === '/__abide/sockets') {
                if (!socketOriginAllowed(request)) {
                    return exit(error(403, 'CSWSH: WebSocket Origin does not match APP_URL.'), {
                        scope: undefined,
                        cors: undefined,
                    })
                }
                const connData: SocketConnectionData = {
                    request,
                    identity: await resolveIdentity(request),
                }
                if (srv.upgrade(request, { data: connData })) return undefined
                return exit(error(426, 'Expected a WebSocket upgrade request.'), {
                    scope: undefined,
                    cors: undefined,
                })
            }
            const info = routeInfo(url, request.method.toUpperCase())
            const route: RouteInfo = {
                kind: info.kind,
                name: info.name,
                params: {},
                url,
                navigating: false,
            }
            // Identity resolution can throw (a malformed/tampered token that fails to unseal). Degrade
            // to an anonymous principal so the request still gets a scope, and defer the error into the
            // in-scope try below so onError sees it (rather than escaping as a bare 500 before scope).
            let identity: Principal
            // The incoming cookie's expiry, so the response can skip re-sealing a cookie that is
            // already live and nowhere near rolling. Undefined = no readable cookie → one must be written.
            let identityExpiresAt: number | undefined
            let scopeError: unknown
            // Parsed once and shared with `resolveIdentity`, which reads `abide-identity` off it.
            const cookies = new Bun.CookieMap(request.headers.get('cookie') ?? '')
            try {
                const resolved = await resolveIdentityDetailed(request, cookies)
                identity = resolved.principal
                identityExpiresAt = resolved.cookieExpiresAt
            } catch (caught) {
                identity = anonymousPrincipal()
                scopeError = caught
            }
            const scope: RequestScope = {
                request,
                cookies,
                identity,
                identityStateless: isMachineBearer(request),
                identityCleared: false,
                identityDirty: false,
                identityExpiresAt,
                bag: {},
                route,
                // The WS-data generic (SocketConnectionData) is a socket-transport concern only; the
                // public server()/scope.server surface stays `Bun.Server<undefined>` (unchanged API).
                server: srv as unknown as Bun.Server<undefined>,
                slots: new Map<string, unknown>(),
                // Always present (undefined when there is no incoming traceparent) rather than spread in
                // conditionally: this object is read by every ambient accessor on every request, so it is
                // built once in its final shape instead of transitioning hidden classes.
                traceparent: propagatedTrace,
            }

            const matched = info.kind === 'rpc' ? routes[info.name] : undefined
            const policy = matched !== undefined ? routePolicy.get(matched) : undefined
            const cors = policy?.cors
            // CORS preflight: answer an OPTIONS to an RPC before the middleware onion. A crossOrigin-less
            // RPC has no CORS policy, so preflight is simply an unsupported method (405 + Allow).
            if (request.method.toUpperCase() === 'OPTIONS' && info.kind === 'rpc') {
                // `preflightResponse` already stamps the CORS headers for the admitted case, so this
                // exit declines the `cors` stage rather than stamping twice. The 405 branch has no
                // policy to stamp. Both still get the trace.
                return exit(
                    cors !== undefined
                        ? preflightResponse(cors, request)
                        : error(405, 'Method not allowed: OPTIONS', {
                              headers: { allow: allowHeaderFor(matched) },
                          }),
                    { scope: undefined, cors: undefined },
                )
            }
            // One selection for every route class: an rpc uses its route policy, a socket-face request
            // uses its socket policy, everything else the global chain.
            const socketChain =
                info.kind === 'socket-subscribe' || info.kind === 'socket-publish'
                    ? socketPolicy.get(info.name)
                    : undefined
            const chain = compose(policy?.middleware ?? socketChain ?? globalMiddleware, () =>
                dispatch(scope, config, startedAt),
            )

            // A pre-stage rather than part of `exit`: it REPLACES the response (a raw 3xx is opaque to
            // a fetch soft-nav) instead of stamping one, and only the nav route class can produce one.
            const softNavEnvelope = (response: Response): Response =>
                info.kind === 'nav' && isSoftNav(request) && isRedirectResponse(response)
                    ? json(
                          { redirect: response.headers.get('location') ?? '', seed: {} },
                          { headers: { vary: 'Abide-Nav' } },
                      )
                    : response

            return runInScope(scope, async () => {
                // The whole request lifecycle — CSRF gate, dispatch, and post-dispatch stamping — runs
                // inside one try so ANY throw is routed to onError in request scope (not just a throw
                // from the middleware/dispatch chain). A deferred identity-resolution failure surfaces
                // here too. The onError response exits through the same stages; if THAT throws, the
                // response leaves with baseline headers only rather than recursing.
                try {
                    if (scopeError !== undefined) throw scopeError
                    // AU8 CSRF gate runs before the middleware onion. A rejected mutation never
                    // dispatches, so it earns no rolling identity cookie — the `scope` stage is
                    // declined. It DOES get CORS: without it a browser reports an opaque CORS failure
                    // instead of surfacing the 403 the server actually sent. A crossOrigin-allowed
                    // origin is exempt from the gate entirely.
                    const rejected = csrfReject(request, cors)
                    if (rejected !== undefined)
                        return await exit(rejected, { scope: undefined, cors })
                    return await exit(softNavEnvelope(await chain()), { scope, cors })
                } catch (caught) {
                    const response = await handleUncaught(caught, config)
                    try {
                        return await exit(softNavEnvelope(response), { scope, cors })
                    } catch (exitError) {
                        log.channel('abide:router').error(
                            'failed to finalize error response:',
                            exitError,
                        )
                        return applyResponseHeaders(response)
                    }
                }
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
                if (frame.t === MUX_UPSTREAM.sub)
                    wsSubscribe(
                        ws,
                        connection,
                        frame.name,
                        frame.args,
                        frame.replay,
                        sockets,
                        config,
                    )
                else if (frame.t === MUX_UPSTREAM.unsub)
                    wsUnsubscribe(connection, frame.name, frame.args)
                else if (frame.t === MUX_UPSTREAM.pub)
                    void wsPublish(ws, frame.name, frame.args, frame.msg, sockets, config)
                // An unrecognized frame type is dropped — but LOUDLY, not silently: a drifted discriminant
                // would otherwise fail open (e.g. an ignored `unsub` keeps a stream pumping). Gated channel,
                // so it never spams prod logs unless DEBUG names it.
                else if (frame.t !== undefined)
                    log.channel('abide:socket').warn('dropped unknown mux frame type:', frame.t)
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

    // This process is now serving THIS app, so this is what `agent()` means by "the app's tools"
    // (AG2.2). A thunk, so a process that never calls `agent()` never walks the routes; withdrawn on
    // `stop()`, so a stopped app is not still answering as the default for whatever boots next.
    const withdrawAgentSurface = provideDefaultAgentSurface(() => rpcTools(config))

    return {
        // Public App surface keeps `Bun.Server<undefined>`; the WS-data generic is internal (see above).
        server: server as unknown as Bun.Server<undefined>,
        origin,
        async stop(): Promise<void> {
            withdrawAgentSurface()
            await server.stop(true)
        },
    }
}

// Hand an rpc handler its RUN deadline through the `Request` it already reads (ADR 0028 D5). No new
// ambient accessor: a handler writes the completely standard `fetch(url, { signal: request().signal })`
// and gets both halves of the rule, because the substituted signal is composed from them:
//
//     crossRequest  →  AbortSignal.timeout(T)
//     otherwise     →  AbortSignal.any([AbortSignal.timeout(T), <the incoming request's signal>])
//
// The fork is D4. A NON-crossRequest slot lives in this request's own scope, so when the client aborts,
// every reader of that slot is dying with the request and the run can never be observed — kill it. A
// crossRequest slot lives in the process-global store and a DIFFERENT request will read the fill, so the
// originating request's death is not the run's death; only the deadline ends it.
//
// ORDER IS LOAD-BEARING, in both directions. It must run AFTER route resolution (the timeout is
// per-rpc) and BEFORE the body is read below — constructing a `Request` from one whose body is already
// disturbed throws. The construction also transfers the body to the new object, which is why the scope's
// request is REPLACED rather than shadowed: the body read further down must happen on the new one.
//
// Two things this deliberately does not reach, recorded rather than papered over: a `crossRequest`
// handler runs scope-exited (`memo.ts`) so `request()` is unavailable to it at all, and an rpc invoked
// IN-PROCESS during page SSR never passes through here — its `request()` is the page's, carrying the
// page's client-abort signal but no deadline component. Both are still bounded at the waiter by the
// memo's own deadline; what they lack is the cooperative teardown signal.
function applyRunDeadlineSignal(scope: RequestScope, meta: RpcMeta<unknown, unknown>): void {
    if (meta.timeout <= 0) return // unbounded by declaration — nothing to arm
    const memoOption = meta.options.memo
    const crossRequest = memoOption !== false && memoOption?.crossRequest === true
    const deadline = AbortSignal.timeout(meta.timeout)
    const signal = crossRequest ? deadline : AbortSignal.any([deadline, scope.request.signal])
    scope.request = new Request(scope.request, { signal })
}
