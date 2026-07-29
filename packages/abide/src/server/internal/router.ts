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

import { CSRF_HEADER } from '../../shared/internal/CSRF_HEADER.ts'
import { generateTraceparent } from '../../shared/internal/generateTraceparent.ts'
import { provideHealthSource } from '../../shared/internal/healthSource.ts'
import { isTimeoutError } from '../../shared/internal/isTimeoutError.ts'
import { logFeed } from '../../shared/internal/logFeed.ts'
import { MUX_UPSTREAM } from '../../shared/internal/MUX_UPSTREAM.ts'
import {
    type MemoFrame,
    memoChannelName,
    publishMemoFrame,
} from '../../shared/internal/memoChannels.ts'
import { NAV_VARY } from '../../shared/internal/NAV_HEADERS.ts'
import { RPC_ROUTE_PREFIX } from '../../shared/internal/RPC_ROUTE_PREFIX.ts'
import { SOCKET_FACE_PREFIX, SOCKETS_ROUTE } from '../../shared/internal/SOCKETS_ROUTE.ts'
import { TRACEPARENT_PATTERN } from '../../shared/internal/TRACEPARENT_PATTERN.ts'
import { log } from '../../shared/log.ts'
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
import {
    applyCors,
    corsAllowOrigin,
    type NormalizedCors,
    normalizeCrossOrigin,
    preflightResponse,
} from './cors.ts'
import { provideDefaultAgentSurface } from './defaultAgentSurface.ts'
import { enforceMethod, methodNotAllowed } from './enforceMethod.ts'
import { errorResponse } from './errorResponse.ts'
import { isProd } from './isProd.ts'
import { logFeedSettings } from './logFeedSettings.ts'
import type { Rpc } from './makeRpc.ts'
import { compose, type Middleware } from './middleware.ts'
import { isSoftNav } from './navRoute.ts'
import { outcomeResponse } from './outcomeResponse.ts'
import {
    anonymousPrincipal,
    makeRequestScope,
    type Principal,
    type RequestScope,
    type RouteInfo,
    type RouteKind,
    runInScope,
} from './requestScope.ts'
import {
    GATE_IN_HANDLER,
    type RouteClass,
    resolveAppClass,
    resolveFrameworkClass,
} from './routeClass.ts'
import { owesGlobalChain, rpcChainFor, throughChain } from './rpcChain.ts'
import { allowedMethodsFor } from './rpcRoute.ts'
import { rpcTools } from './rpcTools.ts'
import { servePublicFile } from './servePublicFile.ts'
import {
    type SocketConnection,
    socketOriginAllowed,
    wsPublish,
    wsSubscribe,
    wsUnsubscribe,
} from './socketMux.ts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// The wire form of a tripped run deadline (ADR 0028 D7). Built through the same `kind` the authoring-side
// `error.typed` carries, so the body holds the name the client narrows on rather than a hand-rolled shape
// that would drift from every other typed error. It is BUILT, not thrown — the deadline has already
// escaped as a throw by the time transport answers it, and re-throwing here would re-enter `handleUncaught`.
const TIMEOUT_RESPONSE = (): Response => errorResponse(504, undefined, { kind: 'TimeoutError' })

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
    const hasAbideHeader = request.headers.get(CSRF_HEADER) !== null
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
            `CSRF: mutations require Content-Type: application/json or an ${CSRF_HEADER} header.`,
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
    if (pathname.startsWith(RPC_ROUTE_PREFIX)) {
        return { kind: 'rpc', name: pathname.slice(RPC_ROUTE_PREFIX.length) }
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

// The multiplexed WS mux itself. The bare address (no trailing slash) is the WS upgrade; the
// `/…/<name>` face above is NOT it — an upgrade cannot travel through the response pipeline. Both are
// derived from one constant, because a browser bundle and a hand-written browser snippet both dial it.
const SOCKET_MUX_ROUTE = SOCKETS_ROUTE

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

// Gate the method a route class declares, then let it answer. `GATE_IN_HANDLER` is the two classes whose
// 405 must follow a match that can 404 (an unknown socket name, an unregistered rpc) — they state the
// reason where they return it.
function gateAndHandle(
    routeClass: RouteClass,
    scope: RequestScope,
    config: AppConfig,
): Response | Promise<Response> {
    const methods = routeClass.methods(scope, config)
    if (methods !== GATE_IN_HANDLER) {
        const rejected = enforceMethod(scope.request, methods)
        if (rejected !== undefined) return rejected
    }
    return routeClass.handle(scope, config)
}

// THE DISPATCH LADDER. Framework rungs, then the public-file probe, then app rungs — the precedence stated
// once, in `routeClass.ts`, where each rung's methods and handler are declared together.
async function dispatch(scope: RequestScope, config: AppConfig): Promise<Response> {
    const url = scope.route.url

    const frameworkClass = resolveFrameworkClass(scope)
    if (frameworkClass !== undefined) return gateAndHandle(frameworkClass, scope, config)

    // `src/ui/public/**` served at its literal path — the rung BETWEEN the two resolvers, which is where
    // its precedence has a reason rather than an order: after everything the framework owns (so a file can
    // never shadow `/openapi.json` or `/__abide/*`) and before everything the app owns (so an app can serve
    // a real `/favicon.ico` without a page pattern intercepting it). Falls through when nothing matches,
    // which is why it is not a route class.
    //
    // The `looksLikeFile` guard is SYNCHRONOUS and runs first on purpose: without it every request — every
    // RPC, every page nav — would allocate a promise and take a microtask tick to `await` a lookup that
    // answers "no" for anything without a file extension. A public asset always has one. Its own 405 lives
    // INSIDE `servePublicFile`, after the file is known to exist, for the reason stated there.
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

    const appClass = resolveAppClass(scope, config)
    if (appClass === undefined) return errorResponse(404, `Not found: ${url.pathname}`)
    return gateAndHandle(appClass, scope, config)
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
            middleware: rpcChainFor(routeDef, config, true),
        })
    }

    // AND THE SAME CHAIN FOR AN IN-PROCESS READ. `middleware` is `(next) => Response` — tracing, rate
    // limiting, context population, auth — so it is part of what a READ means, not of what HTTP means, and
    // it runs per read from whichever door the read came through. Installed here because this is the only
    // place an rpc's route NAME and the app's global middleware are both known (the same reason
    // `bindBroadcast` is installed here), and `makeRpc` stays transport-free.
    //
    // TWO RUNGS, decided PER CALL rather than at boot (`owesGlobalChain`): the rpc's own middleware always
    // runs; the global chain runs only when the caller is not already inside a request that ran it. During
    // page SSR it has run, so a page with eight reads does not count nine hits in a rate limiter; from a
    // cron tick nothing has run, so both rungs do. This is the rule `channelAuth` already applies to a WS
    // subscribe.
    //
    // BEING HERE IS ALSO THE LIMIT: this is the only install site, so a door that never builds an app is
    // unchained. `abide run` never calls `createApp`, and `bootApp` calls it inside the `start()` thunk, so
    // a migration and a pre-`start()` `onStart` warmer run neither rung — see `rpcChain.ts`'s header, which
    // enumerates that gap rather than leaving "every door" to be read as unconditional.
    //
    // The ROUTER does not go through this: it invokes `route.bare(args)` inside the chain it composes above,
    // so arg decoding and `schemas.input` validation stay INSIDE authorization (a 422 must not precede a
    // 403) and the chain still runs exactly once.
    for (const routeDef of Object.values(routes)) {
        const own = routeDef.__rpc.options.middleware ?? []
        // Nothing to run and nothing to decide → leave the callable unwrapped rather than paying a closure
        // and a `currentScope()` read per call for an empty list.
        if (own.length === 0 && globalMiddleware.length === 0) continue
        // biome-ignore lint/suspicious/noExplicitAny: existential rpc — the route's concrete Args/T are erased here; `unknown` breaks assignability through RpcMeta's invariant Args.
        ;(routeDef as Rpc<any, any>).bindChain((_args, produce) =>
            throughChain(rpcChainFor(routeDef, config, owesGlobalChain()), produce),
        )
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
            // `/__abide/chunk/` is the ONE route class that gets no trace: a static byte response with
            // no handler, no identity and an immutable long-cache, joined by no span. Minting an id per
            // chunk fetch would spend entropy and two headers on nothing, and the immutable bytes are
            // shared across users, so a per-request header on them is a lie. Stated here because this is
            // where the mint happens; `chunkAsset.ts` points back at it.
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

// Re-exported so the app-shape types are still reachable from the module that CONSUMES them.
// New code should import them from `./appConfig.ts` directly.
export type { AppConfig, Route } from './appConfig.ts'
