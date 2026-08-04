// THE REQUEST PIPELINE — every HTTP request the app answers, as a named module.
//
// This used to be an anonymous closure inside `Bun.serve({ fetch })`, which had two consequences. The
// 13-stage order below was held by TEXTUAL POSITION and a comment saying the order was load-bearing;
// and the only way to ask "what does this app answer for this request" was to bind an OS port and make
// a network round trip. 41 test files did exactly that — `responseHeaders.test.ts` boots a server over
// loopback to assert three header strings — because there was no other door.
//
// `routeClass.ts` gave each dispatch BRANCH a name. This is the pipeline that runs them.
//
// The seam is deliberately placed where `Bun.serve` hands over: `handleRequest` takes the request, the
// server, the config and the boot-derived policy, and returns the response (or `undefined` when the WS
// upgrade consumed it). It does NOT take a socket, a port or a listener — which is what makes an exit
// path assertable without one. `createTestApp` still boots a real `Bun.serve` on a real port, exactly
// as `docs/spec/testing.md` TE1.1 requires; this is the second door, not a replacement for the first.

import { CSRF_HEADER } from '../../shared/internal/CSRF_HEADER.ts'
import { generateTraceparent } from '../../shared/internal/generateTraceparent.ts'
import { NAV_VARY } from '../../shared/internal/NAV_HEADERS.ts'
import { RPC_ROUTE_PREFIX } from '../../shared/internal/RPC_ROUTE_PREFIX.ts'
import { SOCKET_FACE_PREFIX, SOCKETS_ROUTE } from '../../shared/internal/SOCKETS_ROUTE.ts'
import { TRACEPARENT_PATTERN } from '../../shared/internal/TRACEPARENT_PATTERN.ts'
import { log } from '../../shared/log.ts'
import { json } from '../json.ts'
import type { AppConfig } from './appConfig.ts'
import { applyResponseCompression } from './applyResponseCompression.ts'
import { applyResponseHeaders } from './applyResponseHeaders.ts'
import { appOrigin } from './appOrigin.ts'
import {
    clearIdentityCookieHeader,
    identityCookieHeader,
    identityCookieIsDue,
    resolveIdentity,
    resolveIdentityDetailed,
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
import { enforceMethod, methodNotAllowed } from './enforceMethod.ts'
import { errorResponse } from './errorResponse.ts'
import { compose, type Middleware } from './middleware.ts'
import { isSoftNav } from './navRoute.ts'
import { outcomeResponse, timeoutResponse } from './outcomeResponse.ts'
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
import { rpcChainFor } from './rpcChain.ts'
import { allowedMethodsFor } from './rpcRoute.ts'
import { servePublicFile } from './servePublicFile.ts'
import { socketChainFor } from './socketChain.ts'
import { socketOriginAllowed } from './socketMux.ts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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

    const app = appOrigin()
    if (app.configured) {
        // AU8.3 Origin/Referer check. Prefer the unforgeable `Origin`; fall back to `Referer` when a
        // browser omitted `Origin` on the mutation (older browsers / some same-origin navs). When NEITHER
        // is present we ALLOW — the non-simple-shape gate above is the primary CSRF defense, and a
        // `no-referrer` policy must not break a legitimate request. `Referer` is a full URL; `Origin` is
        // already an origin — `new URL(x).origin` normalizes both to a comparable origin.
        const claimed = request.headers.get('origin') ?? request.headers.get('referer')
        if (claimed !== null) {
            let claimedOrigin: string
            try {
                claimedOrigin = new URL(claimed).origin
            } catch {
                return errorResponse(
                    403,
                    'CSRF: could not verify request Origin/Referer against APP_URL.',
                )
            }
            const appHost = app.origin
            if (appHost === undefined) {
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
    // `name`, which is the same value `AbortSignal.timeout` gives a caller that aborted locally. Shared
    // with `fn.raw`, the other door that answers a read with a Response.
    const timedOut = timeoutResponse(caught)
    if (timedOut !== undefined) return timedOut
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

// The request scope a `socket-connect` middleware runs in. Built through `makeRequestScope` like the
// other two, because an upgrade's scope differs from an HTTP request's only in what it PUTS in the
// fields, not in which fields exist — there is no response to write a rolling identity cookie onto, so
// `identityExpiresAt` is `undefined`, and that is data rather than an omission. It used to be a third
// hand-written 13-field literal here, carrying a header that said the cookie-lifecycle fields were
// "absent rather than present-and-ignored" while three of them were set ten lines below it.
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
    return makeRequestScope({
        request,
        cookies,
        identity,
        identityStateless: isMachineBearer(request),
        identityExpiresAt: undefined,
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
        traceparent: propagatedTrace,
    })
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

// ── THE PER-KIND POLICY TABLE ──────────────────────────────────────────────────────────────────
//
// `CONTEXT.md` ("Route class") says each route class needs the same cross-cutting treatment — method
// gate, CORS, middleware chain, response exit — "which is why those live in one place". `RouteClass`
// declares two of the four: `methods` and `handle`. The other two could not join it, and the reason is
// an ordering constraint rather than an oversight: the chain WRAPS dispatch, and dispatch is what
// resolves the class, so neither is known when the chain has to be composed.
//
// What IS known that early is the KIND (`routeInfo` derives it from the path). So the two remaining
// treatments are declared here, against the kind, as a total `Record` — which buys the same property
// `RouteClass.methods` bought by being required: a new `RouteKind` does not compile until it says which
// chain authorizes it and whether it answers CORS. Before this they were two `info.kind` ladders inline
// in the pipeline, and a new kind picked up the `?? config.middleware` fallback by falling off the end
// of one and the "not an rpc" answer by falling off the other — silently, and in the direction that
// matters, since the fallback is the WEAKER chain.
//
// This is the same shape as the bug that created `routeClass.ts`: the tenth class (page SSR) was added
// with no method gate and answered 404-with-no-`Allow` where every sibling answered 405.
interface RouteKindPolicy {
    // WHICH derived chain authorizes this kind (`CONTEXT.md`, "Chain rung"). `route` is the per-rpc
    // entry (global + the rpc's own `middleware`, merged at boot by `rpcChainFor`); `socket` is the
    // per-socket entry; `global` is the app's own rung alone. An unregistered name under a `route`/
    // `socket` kind finds no entry and falls back to `global`, which is the pre-existing behaviour and
    // is correct: there is no per-route policy to apply to a route that does not exist.
    chain: 'route' | 'socket' | 'global'
    // Whether this kind participates in CORS — an `OPTIONS` preflight to answer, and per-route
    // `Access-Control-*` to stamp. Only an rpc can declare `crossOrigin`, so only an rpc does; every
    // other kind answers `OPTIONS` through its own method gate (a 405 + `Allow`).
    cors: boolean
}

const ROUTE_KIND_POLICY: Record<RouteKind, RouteKindPolicy> = {
    rpc: { chain: 'route', cors: true },
    nav: { chain: 'global', cors: false },
    // The WS upgrade is answered BEFORE this table (an upgrade cannot travel through the response
    // pipeline), and it composes `config.middleware` directly. Declared anyway rather than omitted:
    // the entry is what makes the record total, and `global` is what that branch actually runs.
    'socket-connect': { chain: 'global', cors: false },
    'socket-subscribe': { chain: 'socket', cors: false },
    'socket-publish': { chain: 'socket', cors: false },
}

// The boot-derived, per-surface policy the pipeline reads (`CONTEXT.md`, "Derived-from-the-registry").
// Passed in rather than closed over, which is what lets a caller construct one directly.
export interface RouterPolicy {
    routePolicy: Map<string, { cors: NormalizedCors | undefined; middleware: Middleware[] }>
    socketPolicy: Map<string, Middleware[]>
}

// Derive it. A FUNCTION rather than a block inside `createApp`, for the same reason the pipeline is a
// module: the policy is half of what decides a response, so a test that wants to exercise the pipeline
// against a real registry would otherwise have to restate both loops — and a restated derivation is
// exactly what `CONTEXT.md` records going wrong here twice (an identity-keyed Map that missed every
// rebuilt callable; four derivations with no invalidation at all).
//
// `createApp`'s `rebind` calls this; it does NOT do the two REGISTRY BINDINGS that sit beside it there
// (`bindRpcChains`, the broadcast sink), because those MUTATE the route callables rather than deriving a
// lookup, and a test deriving a policy must not also rewire the app's rpcs.
export function deriveRouterPolicy(config: AppConfig): RouterPolicy {
    const routePolicy = new Map<
        string,
        { cors: NormalizedCors | undefined; middleware: Middleware[] }
    >()
    // KEYED BY NAME, not by the Route object. `abide dev`'s rebuild reassigns `config.routes` to freshly
    // imported callables, and an identity-keyed Map silently missed every one of them: the request then
    // fell back to the bare global chain, so a per-rpc `middleware` and a declared `crossOrigin` stopped
    // applying after the first file save — in the surface an author does all their work in, and with no
    // symptom at the point of failure. A name is what dispatch looks the route up by anyway.
    for (const [name, routeDef] of Object.entries(config.routes ?? {})) {
        routePolicy.set(name, {
            cors: normalizeCrossOrigin(routeDef.__rpc.options.crossOrigin),
            // BOTH RUNGS for the HTTP door: a request is exactly what the global rung authorizes, and
            // the router is the one composer that has one. `dispatch` then invokes `route.__bare(args)`
            // inside this chain, so arg decoding and `schemas.input` validation stay INSIDE
            // authorization (a 422 must not precede a 403) and the chain runs exactly once per read.
            middleware: rpcChainFor(routeDef, config),
        })
    }
    // The socket analog. A socket's own `middleware` authorizes its subscribes and publishes (CLAUDE.md:
    // "the socket analog of an rpc's middleware"); the WS join path already runs it via
    // `authorizeSocketJoin`, so without this the HTTP face was the one way in that skipped it.
    const socketPolicy = new Map<string, Middleware[]>()
    for (const [socketName, sock] of Object.entries(config.sockets ?? {})) {
        socketPolicy.set(socketName, socketChainFor(sock, config, 'http-face'))
    }
    return { routePolicy, socketPolicy }
}

// THE PIPELINE. Every response leaves through `exit()`, in the order below. The order is load-bearing
// and the exhaustiveness is the point: before it was written down, each route class was inlined at
// whatever point in the file its author was reading, and four of them (WS reject, CORS preflight, CSRF
// reject, first-load document) each acquired a different subset of the stamping — a `traceparent`-less
// 403, a preflight with no trace, a CSRF rejection with no `Access-Control-Allow-Origin` (so the browser
// reported an opaque CORS failure instead of the 403 it was handed).
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
// Returns `undefined` for exactly one outcome — a consumed WebSocket upgrade — which is `Bun.serve`'s
// contract for "I took the socket", and the one reason this is not simply `Promise<Response>`.
export async function handleRequest(
    request: Request,
    srv: Bun.Server<SocketConnectionData>,
    config: AppConfig,
    policy: RouterPolicy,
): Promise<Response | undefined> {
    const url = new URL(request.url)

    // STAGE 1. Trace is minted FIRST so stages 2 and 6 — which run before the request scope exists —
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
        return applyResponseHeaders(await applyResponseCompression(response, request, url.pathname))
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
            return exit(errorResponse(403, 'CSWSH: WebSocket Origin does not match APP_URL.'), {
                scope: undefined,
                cors: undefined,
            })
        }
        const connectScope = await socketConnectScope(request, url, srv, propagatedTrace)
        let admitted: Response
        try {
            admitted = await runInScope(
                connectScope,
                compose(config.middleware ?? [], () => UPGRADE_ADMITTED),
            )
        } catch (caught) {
            // A middleware short-circuits by THROWING (`error(401)`/`redirect(...)`). Render it
            // as the reply. Fail CLOSED on anything else: this is an authorization gate, and the
            // safe reading of "the chain did not reach its terminal" is that it did not
            // authorize — never that the upgrade may proceed.
            const rendered = outcomeResponse(caught)
            if (rendered === undefined)
                log.channel('abide:socket').error('socket-connect middleware threw:', caught)
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

    // Both remaining cross-cutting treatments — CORS and the chain rung — are DECLARED against the
    // kind rather than laddered here. See `ROUTE_KIND_POLICY`.
    const kindPolicy = ROUTE_KIND_POLICY[info.kind]

    // Read the registry LIVE, not off a boot-time local: `abide dev` reassigns `config.routes` on
    // every rebuild, and a captured copy answers with the previous build's callables.
    const matched = kindPolicy.chain === 'route' ? config.routes?.[info.name] : undefined
    const routeEntry = matched !== undefined ? policy.routePolicy.get(info.name) : undefined
    const cors = routeEntry?.cors
    // STAGE 6. CORS preflight: answer an OPTIONS before the middleware onion, for the one kind that
    // declares it. A crossOrigin-less RPC has no CORS policy, so preflight is simply an unsupported
    // method (405 + Allow).
    if (request.method.toUpperCase() === 'OPTIONS' && kindPolicy.cors) {
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
    // STAGE 9's rung, read off the table: an rpc uses its route policy, a socket-face request its
    // socket policy, everything else the global rung alone. A `route`/`socket` kind whose NAME is not
    // registered finds no entry and falls back to global, which is what it always did.
    const socketChain =
        kindPolicy.chain === 'socket' ? policy.socketPolicy.get(info.name) : undefined
    const chain = compose(routeEntry?.middleware ?? socketChain ?? config.middleware ?? [], () =>
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
            if (rejected !== undefined) return await exit(rejected, { scope: undefined, cors })
            return await exit(softNavEnvelope(await chain()), { scope, cors })
        } catch (caught) {
            const response = await handleUncaught(caught, config)
            try {
                return await exit(softNavEnvelope(response), { scope, cors })
            } catch (exitError) {
                log.channel('abide:router').error('failed to finalize error response:', exitError)
                return applyResponseHeaders(response)
            }
        }
    }) as Promise<Response>
}
