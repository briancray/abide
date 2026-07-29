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
import { provideHealthSource } from '../../shared/internal/healthSource.ts'
import { IDENTITY_ROUTE } from '../../shared/internal/IDENTITY_ROUTE.ts'
import { isTimeoutError } from '../../shared/internal/isTimeoutError.ts'
import { asStandardSchema } from '../../shared/internal/jsonSchema.ts'
import { LOGS_ROUTE } from '../../shared/internal/LOGS_ROUTE.ts'
import { logFeed } from '../../shared/internal/logFeed.ts'
import { MUX_UPSTREAM } from '../../shared/internal/MUX_UPSTREAM.ts'
import { matchRoute } from '../../shared/internal/matchRoute.ts'
import {
    type MemoFrame,
    memoChannelName,
    publishMemoFrame,
} from '../../shared/internal/memoChannels.ts'
import { NAV_HEADERS, NAV_VARY } from '../../shared/internal/NAV_HEADERS.ts'
import { positiveEnvBytes } from '../../shared/internal/positiveEnvBytes.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { reactiveScope } from '../../shared/internal/reactiveScope.ts'
import { jsonSchemaOf, shapeToSchema } from '../../shared/internal/shapeToSchema.ts'
import { TRACEPARENT_PATTERN } from '../../shared/internal/TRACEPARENT_PATTERN.ts'
import { log } from '../../shared/log.ts'
import { validateStandard } from '../../shared/StandardSchema.ts'
import { json } from '../json.ts'
import type { AppConfig, Route } from './appConfig.ts'
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
import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import type { SocketConnectionData } from './channelAuth.ts'
import { clientBuildFor } from './clientBundle.ts'
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
import { enforceMethod, methodNotAllowed } from './enforceMethod.ts'
import { errorResponse } from './errorResponse.ts'
import { isProd } from './isProd.ts'
import { applicableLayoutPrefixes, sharedLayoutDepth } from './layouts.ts'
import { logFeedSettings } from './logFeedSettings.ts'
import { logsRoute } from './logsRoute.ts'
import type { Mutation, Rpc, RpcMeta } from './makeRpc.ts'
import { handleMcp } from './mcp.ts'
import { compose, type Middleware } from './middleware.ts'
import { navKeepLevels } from './navKeepLevels.ts'
import { negotiateEncoding } from './negotiateEncoding.ts'
import { buildOpenApi } from './openapi.ts'
import { outcomeResponse } from './outcomeResponse.ts'
import { renderPage, streamPageDocument, streamSoftNav } from './pages.ts'
import { projectFormText } from './projectFormText.ts'
import { buildRegistry } from './registry.ts'
import {
    anonymousPrincipal,
    makeRequestScope,
    type Principal,
    type RequestScope,
    type RouteInfo,
    type RouteKind,
    runInScope,
} from './requestScope.ts'
import { rpcTools } from './rpcTools.ts'
import { servePublicFile } from './servePublicFile.ts'
import {
    type SocketConnection,
    socketHttpFace,
    socketOriginAllowed,
    wsPublish,
    wsSubscribe,
    wsUnsubscribe,
} from './socketMux.ts'
import { staticAssetType } from './staticAssetType.ts'
import { streamResponseFor } from './streamResponse.ts'
import { validateFiles } from './validateFiles.ts'
import { validationError } from './validationError.ts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// The wire form of a tripped run deadline (ADR 0028 D7). Built through the same `kind` the authoring-side
// `error.typed` carries, so the body holds the name the client narrows on rather than a hand-rolled shape
// that would drift from every other typed error. It is BUILT, not thrown — the deadline has already
// escaped as a throw by the time transport answers it, and re-throwing here would re-enter `handleUncaught`.
const TIMEOUT_RESPONSE = (): Response => errorResponse(504, undefined, { kind: 'TimeoutError' })

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
        return errorResponse(
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
                return errorResponse(
                    403,
                    'CSRF: could not verify request Origin/Referer against APP_URL.',
                )
            }
            // A mismatch is rejected UNLESS this RPC opted into cross-origin access for it (the
            // `crossOrigin` allowlist) — CORS is the sanctioned way to admit a foreign origin.
            if (
                claimedOrigin !== appHost &&
                corsAllowOrigin(cors ?? NO_CORS, claimedOrigin) === undefined
            ) {
                return errorResponse(403, 'CSRF: request Origin/Referer does not match APP_URL.')
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

// The methods an rpc route admits, derived from its DECLARED verb — the whole gate, since a handler
// serves exactly one. HEAD is not in the list: `enforceMethod` derives it from GET (ADR 0027 D6), so
// there is no second statement of that rule here. An unmatched name has no declared verb to report,
// so it names the full set.
//
// This used to be `allowHeaderFor`, a HEADER — five independent literals, none agreeing. Returning the
// method LIST instead is what lets the rpc gate be `enforceMethod` rather than a hand-rolled compare
// that re-implemented the HEAD rule next to a helper written to own it.
const ANY_RPC_METHOD = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function allowedMethodsFor(route: Route | undefined): readonly string[] {
    const meta = route?.__rpc
    return meta === undefined ? ANY_RPC_METHOD : [meta.method]
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

// Last-resort handler for an error that escaped the middleware/dispatch chain. Runs in request scope, so
// the app's `onError` can read request()/route()/identity() ambiently. The hook may return a Response to
// shape the client reply; anything else (or a throwing hook) falls back to a generic 500 that never leaks
// the detail.
//
// This is also the DESERIALIZING half of transport: `error()`/`redirect()` throw (`rpc = memo + transport`
// — a handler is a memo body, and a memo's failure channel is a throw), so a deliberate outcome arrives
// here as a `Redirect`/`HttpError` and is rendered at its own status. Both are answered BEFORE `onError`,
// alongside the tripped-deadline case below, on the same rule: a declared 404 or a login redirect is not a
// bug in the app, so it must not fire the app's error hook nor collapse into the generic 500 — which is
// exactly what a thrown failure used to do, losing its status on the way out.
async function handleUncaught(caught: unknown, config: AppConfig): Promise<Response> {
    // A DELIBERATE outcome: rendered at the status the handler asked for (a 3xx + Location for a redirect),
    // carrying a typed failure's name/data so `fn.isError(e, name)` narrows the same on both sides after
    // the browser proxy decodes it back.
    const outcome = outcomeResponse(caught)
    if (outcome !== undefined) return outcome
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
            // The hook shapes the reply by RETURNING a Response or by calling `error(...)`/`redirect(...)`,
            // which throw — both are deliberate, so both shape it. Only an UNEXPECTED throw from the hook
            // falls through to the generic 500; a hook that fails while reporting a failure cannot be
            // trusted to have produced a reply.
            const shaped = outcomeResponse(hookError)
            if (shaped !== undefined) return shaped
            log.channel('abide:router').error('onError hook threw:', hookError)
        }
    }
    return errorResponse(500, 'Internal Server Error')
}

export interface App {
    server: Bun.Server<undefined>
    origin: string
    stop(): Promise<void>
}

// C6-nav: a soft-nav request is a GET/HEAD nav carrying the `Abide-Nav: <currentPath>` header —
// the client already has the document shell and wants only the next page's inner HTML + seed.
function isSoftNav(request: Request): boolean {
    if (request.headers.get(NAV_HEADERS.from) === null) return false
    const method = request.method.toUpperCase()
    return method === 'GET' || method === 'HEAD'
}

// C6-nav: how many outer layout levels the client says it is KEEPING (`NAV_HEADERS.keep`). Absent — an
// older browser bundle, or any non-browser caller — leaves the router's own `sharedLayoutDepth`
// derivation to stand. A malformed or negative value is treated as absent for the same reason: falling
// back renders MORE of the tree, which is always placeable, so there is no outcome worth a 400 in it.
function navKeepDeclared(request: Request): number | null {
    const raw = request.headers.get(NAV_HEADERS.keep)
    if (raw === null) return null
    // Before `Number`, because `Number('')` is `0` — an empty header would otherwise read as the most
    // consequential value the field has ("keep nothing"), which is the opposite of saying nothing.
    const text = raw.trim()
    if (text.length === 0) return null
    const value = Number(text)
    if (!Number.isInteger(value) || value < 0) return null
    return value
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

// The multiplexed WS mux itself (the socket HTTP FACE is the `/…/<name>` prefix above).
const SOCKET_MUX_ROUTE = '/__abide/sockets'

// The terminal of the socket-connect chain. Compared by IDENTITY, so a middleware returning its own
// response — of ANY status — reads as the short-circuit it is.
const UPGRADE_ADMITTED = new Response(null, { status: 101 })

// The request scope a `socket-connect` middleware runs in. Deliberately NOT the full HTTP scope: an
// upgrade has no response to write a rolling identity cookie onto (a successful upgrade returns
// `undefined`), so the cookie-lifecycle fields are absent rather than present-and-ignored.
//
// Identity resolution FAILS CLOSED to anonymous. A tampered token that will not unseal must reach the
// chain as "nobody", so an app's `requireLogin` denies it — degrading to anonymous is what makes the
// gate meaningful, where throwing here would 500 and letting it through would be the bug this fixes.
async function socketConnectScope(
    request: Request,
    url: URL,
    srv: Bun.Server<SocketConnectionData>,
    propagatedTrace: string | undefined,
): Promise<RequestScope> {
    const cookies = new Bun.CookieMap(request.headers.get('cookie') ?? '')
    let identity: Principal
    try {
        identity = await resolveIdentity(request)
    } catch {
        identity = anonymousPrincipal()
    }
    return {
        request,
        cookies,
        identity,
        identityStateless: isMachineBearer(request),
        identityCleared: false,
        identityDirty: false,
        identityExpiresAt: undefined,
        bag: {},
        route: {
            kind: 'socket-connect',
            name: SOCKET_MUX_ROUTE,
            params: {},
            url,
            navigating: false,
        },
        // The WS-data generic is a socket-transport concern only; the public `server()` surface stays
        // `Bun.Server<undefined>`.
        server: srv as unknown as Bun.Server<undefined>,
        slots: new Map<string, unknown>(),
        traceparent: propagatedTrace,
    }
}

async function dispatch(scope: RequestScope, config: AppConfig): Promise<Response> {
    const routes = config.routes ?? {}
    const url = scope.route.url

    // AU3 / the isomorphic `identity()`: the caller's OWN resolved principal — what the ladder already
    // decided this request is, handed back verbatim. It discloses nothing they do not hold (their next
    // request IS this identity), which is what makes it safe to answer without ceremony; a browser's
    // `identity.refresh()` and a compiled binary's `identity` subcommand both read it. Inside the
    // middleware chain like every other route, so an app that gates its surface gates this too.
    if (url.pathname === IDENTITY_ROUTE) {
        const rejected = enforceMethod(scope.request, ['GET'])
        if (rejected !== undefined) return rejected
        return Response.json(identity())
    }

    // The log feed (opt-in; 404 when this deployment did not enable it). Inside the middleware chain
    // like `/__abide/identity` above — an app that gates its surface gates its logs too, which is the
    // whole authorization story for this route.
    if (url.pathname === LOGS_ROUTE) {
        const rejected = enforceMethod(scope.request, ['GET'])
        if (rejected !== undefined) return rejected
        return logsRoute(url, scope.request.signal)
    }

    if (url.pathname === '/__abide/health') {
        const rejected = enforceMethod(scope.request, ['GET'])
        if (rejected !== undefined) return rejected
        // CO2.4: the whole document — baseline, bind clock, and the app's `onHealth` fields merged over
        // it — is composed by `health()` itself, which this request scope makes request-scoped for the
        // hook (it reads `identity()`/`context()`). All that is left here is the status code, so an
        // in-proc `await health()` and a probe's GET can never describe the app differently.
        const result = await health()
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
        const rejected = enforceMethod(scope.request, ['GET'])
        if (rejected !== undefined) return rejected
        // This route is the one that still needs the verb AFTER the gate: it builds the body itself, so
        // it has to drop it for HEAD (and state `Content-Length` for the representation a GET would have
        // returned). Everywhere else the gate is the only reader of the method.
        const method = scope.request.method.toUpperCase()
        const name = url.pathname.slice(CHUNK_PREFIX.length)
        const build = await clientBuildFor(config)
        const asset = build.files.get(name)
        if (asset === undefined) return errorResponse(404, `Not found: ${url.pathname}`)
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
        const rejected = enforceMethod(scope.request, ['GET'])
        if (rejected !== undefined) return rejected
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
                    // C6.2: how many outer layouts the client is KEEPING (`navKeepLevels`, which owns
                    // the precedence and the clamp). Render only the diverging suffix; the client grafts
                    // + claims it into the innermost kept layout's outlet.
                    const fromPath = scope.request.headers.get(NAV_HEADERS.from)
                    const fromMatch = fromPath !== null ? matchRoute(patterns, fromPath) : null
                    const layoutConfig = config.layouts ?? {}
                    const sharedLevels = navKeepLevels(
                        navKeepDeclared(scope.request),
                        fromMatch !== null
                            ? sharedLayoutDepth(fromMatch.pattern, match.pattern, layoutConfig)
                            : 0,
                        applicableLayoutPrefixes(match.pattern, layoutConfig).length,
                    )
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
                            vary: NAV_VARY,
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
                        vary: NAV_VARY,
                    },
                })
            } catch (caught) {
                log.channel('abide:router').error(
                    `page render failed for "${match.pattern}":`,
                    caught,
                )
                return errorResponse(500, 'Page render failed.')
            }
        }
        return errorResponse(404, `Not found: ${url.pathname}`)
    }

    const route = routes[scope.route.name]
    if (route === undefined) {
        return errorResponse(404, `Unknown rpc: ${scope.route.name}`)
    }

    const meta = route.__rpc
    // The declared verb is ENFORCED, not just advertised. `auth.md` §AU8 grounds the whole
    // SameSite=Lax argument on "mutations are never on GET" — the top-level cross-site GET that Lax
    // still admits carries the identity cookie and skips the CSRF gate (`csrfReject` exempts reads),
    // so a mutation reachable over GET is a CSRF hole no matter what the handler was declared as.
    // HEAD is the one derived verb: it IS GET minus the body (ADR 0027 D6), so it reaches a GET rpc.
    const denied = enforceMethod(scope.request, [meta.method])
    if (denied !== undefined) return denied
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
            return errorResponse(413, `Request body exceeds maxBodySize (${maxBodySize} bytes).`)
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
                return errorResponse(
                    413,
                    `Request body exceeds maxBodySize (${maxBodySize} bytes).`,
                )
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
            // Re-served through the SAME encoding decision the fresh run makes — including the
            // `Accept` rung, which this half used to skip, so an untagged source resumed as jsonl
            // after having been served as sse.
            const response = streamResponseFor(resumed.cursor, scope.request)
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
        const response = streamResponseFor(result, scope.request)
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

            // Multiplexed socket WS upgrade (sockets.md S3.1). CSWSH-gated, then the GLOBAL middleware
            // chain, then the upgrade. Identity is resolved ONCE here (same cookie/bearer ladder as the
            // HTTP path) and carried on the connection so `@rpc:` cache-channel joins can re-authorize
            // against it per subscribe (§2.3).
            //
            // THE CHAIN RUNS HERE, and did not used to. `auth.md` §13.4 says "RPC, nav, socket-connect,
            // and HTTP-face socket ops all pass the same chain", and S4.4 says WS runs it at
            // `socket-connect` — but this branch returned before the chain was ever composed, so no
            // middleware ran for a WebSocket at all. `authorizeSocketJoin` then admitted any socket
            // declaring no `middleware` of its own, on the stated premise that "the global chain already
            // ran at the WS upgrade". It had not. An app whose only global middleware was `requireLogin`
            // answered an anonymous rpc with 401 and admitted the same anonymous caller to a socket
            // subscribe — and to every message published to it.
            //
            // Only the GLOBAL chain: a socket's own `middleware` is the per-ROOM refinement and needs
            // room args, which no connection has (one connection carries many rooms). That runs at
            // subscribe, in `authorizeSocketJoin`, and now genuinely layers on top of a connect gate.
            if (url.pathname === SOCKET_MUX_ROUTE) {
                if (!socketOriginAllowed(request)) {
                    return exit(
                        errorResponse(403, 'CSWSH: WebSocket Origin does not match APP_URL.'),
                        {
                            scope: undefined,
                            cors: undefined,
                        },
                    )
                }
                const connectScope = await socketConnectScope(request, url, srv, propagatedTrace)
                let admitted: Response
                try {
                    admitted = await runInScope(
                        connectScope,
                        compose(globalMiddleware, () => UPGRADE_ADMITTED),
                    )
                } catch (caught) {
                    // A middleware short-circuits by THROWING (`error(401)`/`redirect(...)`). Render it
                    // as the reply. Fail CLOSED on anything else: this is an authorization gate, and the
                    // safe reading of "the chain did not reach its terminal" is that it did not
                    // authorize — never that the upgrade may proceed.
                    const rendered = outcomeResponse(caught)
                    if (rendered === undefined)
                        log.channel('abide:socket').error(
                            'socket-connect middleware threw:',
                            caught,
                        )
                    return exit(rendered ?? (await handleUncaught(caught, config)), {
                        scope: undefined,
                        cors: undefined,
                    })
                }
                // A middleware may legitimately return its own 2xx, and returning ANY response instead
                // of the terminal's IS the short-circuit — so the sentinel is compared by IDENTITY,
                // never by status.
                if (admitted !== UPGRADE_ADMITTED)
                    return exit(admitted, { scope: undefined, cors: undefined })

                const connData: SocketConnectionData = {
                    request,
                    identity: connectScope.identity,
                    // Carried so a per-room re-authorization can rebuild the SAME scope this upgrade
                    // ran in. Without it a global middleware calling `server()` threw inside the
                    // re-auth, which fails closed — silently denying every join.
                    server: srv as unknown as Bun.Server<undefined>,
                }
                if (srv.upgrade(request, { data: connData })) return undefined
                return exit(errorResponse(426, 'Expected a WebSocket upgrade request.'), {
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
            const scope: RequestScope = makeRequestScope({
                request,
                cookies,
                identity,
                identityStateless: isMachineBearer(request),
                identityExpiresAt,
                route,
                // The WS-data generic (SocketConnectionData) is a socket-transport concern only; the
                // public server()/scope.server surface stays `Bun.Server<undefined>` (unchanged API).
                server: srv as unknown as Bun.Server<undefined>,
                traceparent: propagatedTrace,
            })

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
                        : methodNotAllowed('OPTIONS', allowedMethodsFor(matched)),
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
                dispatch(scope, config),
            )

            // A pre-stage rather than part of `exit`: it REPLACES the response (a raw 3xx is opaque to
            // a fetch soft-nav) instead of stamping one, and only the nav route class can produce one.
            const softNavEnvelope = (response: Response): Response =>
                info.kind === 'nav' && isSoftNav(request) && isRedirectResponse(response)
                    ? json(
                          { redirect: response.headers.get('location') ?? '', seed: {} },
                          { headers: { vary: NAV_VARY } },
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
    const withdrawAgentSurface = provideDefaultAgentSurface(() => rpcTools(config, origin))

    // …and this is what `health()` means by "the app" (CO2.4): the bind clock plus the app's own hook.
    // Withdrawn on `stop()` by the same rule — a stopped app must not keep answering for its health.
    // A getter, not a captured value: `abide dev` reloads by swapping `config`'s properties in place
    // while this router keeps running, so an `onHealth` read at bind would be the one the app had when
    // the process started and no save would ever replace it.
    const withdrawHealthSource = provideHealthSource({
        startedAt,
        get onHealth() {
            return config.onHealth
        },
    })

    return {
        // Public App surface keeps `Bun.Server<undefined>`; the WS-data generic is internal (see above).
        server: server as unknown as Bun.Server<undefined>,
        origin,
        async stop(): Promise<void> {
            withdrawAgentSurface()
            withdrawHealthSource()
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

// Re-exported so the app-shape types are still reachable from the module that CONSUMES them.
// New code should import them from `./appConfig.ts` directly.
export type { AppConfig, Route } from './appConfig.ts'
