// ROUTE CLASSES — one declared entry per branch of the router's dispatch.
//
// A route class is the pair (methods it SERVES, how it answers). `dispatch` resolves one, gates the
// method, and calls it. That is the whole of dispatch now, where it used to be a ten-branch ladder in
// which four classes were one-line delegations and three were forty-to-a-hundred-and-fifty inline lines.
//
// WHY `methods` IS PART OF THE CLASS AND NOT A CALL INSIDE IT. `enforceMethod` exists because the check had
// been written out per route class five times and OMITTED from three, so `POST /openapi.json`,
// `/__abide/identity` and `/__abide/health` each answered 200 with their document. Its own header states
// the rule: "a rule stated once and applied per-call-site is a rule the next route class forgets." Giving
// the gate ONE OWNER did not finish that job, because CALLING it was still per-branch — six of the eleven
// call sites in the tree were the identical `enforceMethod(scope.request, ['GET'])`, each inline in a
// different arm of one function — and the tenth route class had already been added without one: a `POST
// /users/7` against an app with a `/users/[id]` page answered 404 with no `Allow` while every sibling
// answered 405 + `Allow: GET, HEAD`. Declaring the methods makes the gate structural: a class cannot skip
// it by not mentioning it, because there is nowhere to not mention it.
//
// RESOLUTION IS AN ORDERED LADDER, DELIBERATELY, not a table of predicates. The precedence is real and was
// already documented in prose (framework endpoints → socket face → public files → page/rpc), and matching
// is a chain of cheap string compares that runs on EVERY request. An array of `match(scope)` closures would
// pay a call per entry per request to express the same order — a trade the router already refuses next door
// (`looksLikeFile` is two `indexOf`s in front of the public-file lookup for exactly this reason). So the
// ladder stays; only its BODIES became classes.
//
// THE LADDER IS SPLIT IN TWO, at the public-file rung, because that rung is where the precedence has a
// REASON rather than an order: `src/ui/public/**` is checked after everything the FRAMEWORK owns (so a
// file can never shadow `/openapi.json` or `/__abide/*`) and before everything the APP owns (so an app can
// serve a real `/favicon.ico` without a page pattern intercepting it). It is not a class itself — its match
// is an async filesystem lookup that can MISS, and a miss must fall through — so it stays inline in
// `dispatch`, between the two resolvers.
//
// `methods()` is a function rather than a field so every class can be a module-level constant with no
// per-request allocation, while the rpc class — whose gate is the matched route's DECLARED verb — still
// answers per request.

import { health } from '../../shared/health.ts'
import { identity } from '../../shared/identity.ts'
import { HEALTH_ROUTE } from '../../shared/internal/HEALTH_ROUTE.ts'
import { IDENTITY_ROUTE } from '../../shared/internal/IDENTITY_ROUTE.ts'
import { LOGS_ROUTE } from '../../shared/internal/LOGS_ROUTE.ts'
import { json } from '../json.ts'
import type { AppConfig } from './appConfig.ts'
import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import { handleChunkAsset } from './chunkAsset.ts'
import { logsRoute } from './logsRoute.ts'
import { handleMcp } from './mcp.ts'
import { handleNavRoute, matchNavRoute } from './navRoute.ts'
import { buildOpenApi } from './openapi.ts'
import { buildRegistry } from './registry.ts'
import type { RequestScope } from './requestScope.ts'
import { allowedMethodsFor, handleRpcRoute } from './rpcRoute.ts'
import { socketHttpFace } from './socketMux.ts'

// A class whose 405 must come AFTER a match that can 404, so its gate cannot move out front: answering 405
// for a resource that does not exist would be wrong, and the `Allow` header would confirm it might. Two
// classes are like this — the socket HTTP face (an unknown socket name is a 404) and an rpc whose name is
// not registered — and each states the reason where it returns this.
export const GATE_IN_HANDLER = 'own' as const

export type ServedMethods = readonly string[] | typeof GATE_IN_HANDLER

export interface RouteClass {
    // The methods this class SERVES. `HEAD` is never named — `enforceMethod` derives it from `GET`
    // (ADR 0027 D6).
    methods(scope: RequestScope, config: AppConfig): ServedMethods
    handle(scope: RequestScope, config: AppConfig): Response | Promise<Response>
}

// Shared so the read-only classes below allocate nothing to say the same thing.
const GET_ONLY: readonly string[] = ['GET']
const POST_ONLY: readonly string[] = ['POST']

// AU3 / the isomorphic `identity()`: the caller's OWN resolved principal — what the ladder already decided
// this request is, handed back verbatim. It discloses nothing they do not hold (their next request IS this
// identity), which is what makes it safe to answer without ceremony; a browser's `identity.refresh()` and a
// compiled binary's `identity` subcommand both read it. Inside the middleware chain like every other route,
// so an app that gates its surface gates this too.
const IDENTITY_CLASS: RouteClass = {
    methods: () => GET_ONLY,
    handle: () => Response.json(identity()),
}

// The log feed (opt-in; 404 when this deployment did not enable it). Inside the middleware chain like
// `/__abide/identity` above — an app that gates its surface gates its logs too, which is the whole
// authorization story for this route.
const LOGS_CLASS: RouteClass = {
    methods: () => GET_ONLY,
    handle: (scope) => logsRoute(scope.route.url, scope.request.signal),
}

// CO2.4: the whole document — baseline, bind clock, and the app's `onHealth` fields merged over it — is
// composed by `health()` itself, which this request scope makes request-scoped for the hook (it reads
// `identity()`/`context()`). All that is left here is the status code, so an in-proc `await health()` and a
// probe's GET can never describe the app differently.
const HEALTH_CLASS: RouteClass = {
    methods: () => GET_ONLY,
    async handle(): Promise<Response> {
        const result = await health()
        const unhealthy = result.reachable === false
        // Give a probing client/proxy a concrete back-off instead of hammering an unhealthy app.
        return json(result, {
            status: unhealthy ? 503 : 200,
            ...(unhealthy ? { headers: { 'retry-after': '30' } } : {}),
        })
    },
}

const CHUNK_CLASS: RouteClass = {
    methods: () => GET_ONLY,
    handle: handleChunkAsset,
}

// MS4: the OpenAPI 3.1 document, derived from the registry. Served by default and reached through the
// middleware onion (dispatch runs inside it), so the app can gate it with middleware — no framework-default
// auth (DX8).
const OPENAPI_CLASS: RouteClass = {
    methods: () => GET_ONLY,
    handle: (_scope, config) => json(buildOpenApi(buildRegistry(config))),
}

// MS2: the MCP server (JSON-RPC 2.0 over HTTP POST), derived from the registry. Like OpenAPI it is reached
// through the middleware onion so the app can gate it — no framework-default auth (MS2.5/DX8). Its gate
// used to be `handleMcp`'s first statement; declared here instead, so it is the same one line every other
// class states and `handleMcp` is left with only MCP.
const MCP_CLASS: RouteClass = {
    methods: () => POST_ONLY,
    handle: (scope, config) => handleMcp(scope.request, config),
}

// S3.2: the per-socket HTTP face, in the onion for the same reason OpenAPI and MCP are — the app gates it
// with middleware. `route()` reports `socket-subscribe`/`socket-publish`, so a middleware can tell a
// subscribe from a publish. Iterating a socket here does NOT hit the SSR snapshot-then-complete path: that
// keys off `reactiveScope().rendering`, which only a page render sets, so the SSE subscribe stays live.
const SOCKET_FACE_CLASS: RouteClass = {
    // GATE_IN_HANDLER: an unknown socket name answers 404, and that check runs FIRST — a 405 out front
    // would answer "wrong verb" for a socket that does not exist, and its `Allow` would say it might.
    methods: () => GATE_IN_HANDLER,
    handle: (scope, config) =>
        socketHttpFace(scope.request, scope.route.name, config.sockets ?? {}),
}

// M5b nav page SSR (C6/C6-nav). Runs inside the request scope + middleware onion (dispatch is the chain
// terminal), so a short-circuiting middleware blocks a page like any other request.
const NAV_CLASS: RouteClass = {
    methods: () => GET_ONLY,
    handle: handleNavRoute,
}

// The declared verb is ENFORCED, not just advertised. `auth.md` §AU8 grounds the whole SameSite=Lax
// argument on "mutations are never on GET" — the top-level cross-site GET that Lax still admits carries the
// identity cookie and skips the CSRF gate (`csrfReject` exempts reads), so a mutation reachable over GET is
// a CSRF hole no matter what the handler was declared as.
const RPC_CLASS: RouteClass = {
    methods(scope, config): ServedMethods {
        const routes = config.routes ?? {}
        const route = routes[scope.route.name]
        // GATE_IN_HANDLER for an unregistered name, for the same reason the socket face uses it: the
        // handler answers 404, and gating out front would turn an unknown rpc into a 405 whose `Allow`
        // enumerates every verb the framework serves.
        if (route === undefined) return GATE_IN_HANDLER
        return allowedMethodsFor(route)
    },
    handle: handleRpcRoute,
}

// Rungs the FRAMEWORK owns. Resolved before the public-file probe, so a file in `src/ui/public/**` can
// never shadow one of these.
export function resolveFrameworkClass(scope: RequestScope): RouteClass | undefined {
    const pathname = scope.route.url.pathname
    if (pathname === IDENTITY_ROUTE) return IDENTITY_CLASS
    if (pathname === LOGS_ROUTE) return LOGS_CLASS
    if (pathname === HEALTH_ROUTE) return HEALTH_CLASS
    if (pathname.startsWith(CHUNK_PREFIX)) return CHUNK_CLASS
    if (pathname === '/openapi.json') return OPENAPI_CLASS
    if (pathname === '/__abide/mcp') return MCP_CLASS
    if (scope.route.kind === 'socket-subscribe' || scope.route.kind === 'socket-publish') {
        return SOCKET_FACE_CLASS
    }
    return undefined
}

// Rungs the APP owns. Resolved after the public-file probe. `undefined` means nothing claimed the path,
// which is the router's 404.
//
// `matchNavRoute` sets `route().name`/`params` as a side effect, because the pattern match IS what produces
// them and the handler must not repeat it.
export function resolveAppClass(scope: RequestScope, config: AppConfig): RouteClass | undefined {
    if (scope.route.kind === 'rpc') return RPC_CLASS
    if (matchNavRoute(scope, config)) return NAV_CLASS
    return undefined
}
