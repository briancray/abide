// THE MIDDLEWARE CHAIN AN RPC RUNS UNDER — one definition, and the adapter that lets a VALUE call run it.
//
// `middleware` is not just auth. It is `(next) => Response`: tracing, rate limiting, request-context
// population, response post-processing, and authorization. So a read that skips the chain is not merely
// unauthorized, it is unobserved — which is why an rpc's own middleware runs PER READ, wherever the read
// comes from, rather than only on the HTTP path.
//
// TWO RUNGS, AND THEY ANSWER DIFFERENT QUESTIONS — which is why each has its own periodicity and its own
// composer, rather than one list selected by a flag:
//
//   the rpc's OWN middleware — per READ, from every door. It is part of what the rpc's declaration means.
//   the GLOBAL chain (`config.middleware`) — per REQUEST. It runs where a REQUEST exists to authorize:
//     the router at mount, and `channelAuth`'s `@rpc:` join, which synthesizes a request-shaped scope
//     precisely so it can run it. Nowhere else, and never scope-free.
//
// The failure worth naming in each direction. If the global chain re-ran per read, a page with eight reads
// would count NINE hits in a rate limiter and log nine request lines for one request. And if it ran with no
// request behind it — which it DID, selected by an `owesGlobalChain()` that read `currentScope() ===
// undefined` as "nothing has run it, so run it" — then a cron tick's read entered the app's own tracer,
// which reached for `request()`, threw, and failed the read closed inside the middleware whose job was to
// observe it. Two questions ("has a request run it?" / "should it run here?") with one answer between them.
//
// SO THE OWN RUNG IS THE ONLY ONE A VALUE CALL RUNS, and it reaches every door of a built app — HTTP (as
// part of the chain the router composes around dispatch), page SSR, a handler reading a sibling rpc, a cron
// tick, and an `abide run` migration. `bindRpcChains` is what installs it, and it is called from all three
// boots (`createApp`, the dev server's rebuild, `abide run`) rather than only from `createApp` — which is
// what made a migration's reads unauthorized and a dev server's reads unauthorized after the first file
// save. `fn.raw()` remains outside the chain, by construction: it calls the handler, not `produce`.
//
// AND IT RUNS WITH `route()` DESCRIBING THE READ, not the caller who made it — see `chainScope`, which is
// where the SUBJECT of the authorization decision is established, and why that has to be a scope rather
// than an assignment.
//
// WHY THE CHAIN CANNOT MOVE INSIDE THE MEMO. The obvious shape — wrap the handler, i.e. the memo BODY — is
// wrong for authorization, and quietly: a memo coalesces by ARGS, not by identity, so two different
// principals reading the same args share one run and would share one middleware run with it. The first
// caller's authorization would stand in for the second's. The chain therefore wraps the CALL, outside the
// memo, and the memo still coalesces the work underneath it.

import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { RPC_ROUTE_PREFIX } from '../../shared/internal/RPC_ROUTE_PREFIX.ts'
import {
    enterScope,
    exitScope,
    peekReactiveScope,
    type ReactiveScope,
} from '../../shared/internal/reactiveScope.ts'
import type { RouteInfo } from '../../shared/internal/routeInfo.ts'
import { toHttpError } from '../../shared/internal/toHttpError.ts'
import type { AppConfig, Route } from './appConfig.ts'
import type { Rpc } from './makeRpc.ts'
import { compose, type Middleware } from './middleware.ts'

// THE OWN RUNG — per READ, from every door. One definition, so the bind site and `rpcChainFor` below
// cannot come to disagree about what "the rpc's own middleware" is.
function ownMiddlewareFor(route: Route): Middleware[] {
    return route.__rpc.options.middleware ?? []
}

// BOTH RUNGS, for a caller that has a request scope to interpret — the router at mount, and
// `channelAuth` per `@rpc:` join. It used to be spelled out at both sites independently, which is two
// places that had to agree about a list whose whole job is authorization.
//
// There is no `includeGlobal` parameter any more, and its absence is the decision: the global rung is
// per REQUEST, so it runs where a request exists to authorize and nowhere else. It used to be selected
// by `owesGlobalChain()` (`currentScope() === undefined`), which conflated two different questions —
// "has a request already run the global chain?" with "should the global chain run here?" — and answered
// the second with the first. The consequence was a landmine: a scope-free read (a cron tick) ran the
// global chain with NO request behind it, so the app's own tracer or rate limiter reached for
// `request()` and threw, failing the read closed inside the middleware that was supposed to observe it.
export function rpcChainFor(route: Route, config: AppConfig): Middleware[] {
    const own = ownMiddlewareFor(route)
    const global = config.middleware ?? []
    // Allocating only when both rungs are non-empty keeps the common case (no per-rpc middleware) off the
    // spread path; the router's boot-time `routePolicy` still pre-derives its own copy once per route.
    if (own.length === 0) return global
    if (global.length === 0) return own
    return [...global, ...own]
}

// INSTALL THE PER-READ CHAIN on every route of an app. Called from all three boots — `createApp`, the dev
// server's rebuild, and `abide run` — because WHICH DOOR BUILT THE APP must not decide whether a read is
// authorized. It used to be a loop inside `createApp` and nowhere else, which is exactly how two silent
// holes opened: `abide run` never calls `createApp`, so a migration's reads ran unchained; and `abide dev`'s
// rebuild swaps `config.routes` for FRESH callables, so every read after the first file save ran unchained
// too, in the surface an author does all their work in.
//
// Idempotent by construction: `__bindChain` REPLACES the runner rather than nesting, so calling this twice
// on the same route cannot end up running its middleware twice.
export function bindRpcChains(config: AppConfig): void {
    for (const [name, route] of Object.entries(config.routes ?? {})) {
        const own = ownMiddlewareFor(route)
        // Nothing to run → leave the callable unwrapped rather than paying a closure, a scope read and a
        // `RouteInfo` allocation per call for an empty list. The GLOBAL rung is deliberately not consulted
        // here: it is per REQUEST, and a value call is not one.
        if (own.length === 0) continue
        // biome-ignore lint/suspicious/noExplicitAny: existential route — the registry erases each rpc's concrete Args/T, and `Route` being a UNION intersects the value and streaming runner signatures into one nothing satisfies.
        ;(route as Rpc<any, any>).__bindChain((args, produce) =>
            throughChain(own, produce, { name, args }),
        )
    }
}

// The terminal's pass token. Compared by IDENTITY, never by status, for the same reason `channelAuth` and
// the socket upgrade gate do: a middleware may legitimately return its own 2xx, and returning ANY response
// instead of the terminal's IS the short-circuit.
const REACHED_TERMINAL = new Response(null, { status: 204 })

// WHAT `route()` ANSWERS INSIDE THE CHAIN: the read being authorized, not the caller that made it.
//
// This is the fix for the failure mode that made the per-read chain worse than useless on the SSR door.
// `auth.md`'s canonical guard is `route().name === 'deleteUser' && … error(403)`, and `route()` reads the
// ACTIVE REACTIVE SCOPE — which during page SSR is the nav's, so the guard saw `kind: 'nav'` and the page's
// pattern and silently never fired. Not running the middleware at all was honest; running it with the
// wrong subject looked like coverage and was not.
//
// A SHALLOW COPY THAT SHARES `slots`, not a fresh scope. `currentScope()` resolves the request scope by
// comparing its `slots` Map to the active reactive scope's BY IDENTITY, so sharing that one Map is exactly
// what keeps `request()`/`cookies()`/`context()` answering the caller's real request while `route()`
// answers the read. `identity`/`identityWrite`/`traceparent` come along by the copy, so a middleware's
// `identity()` is still the caller's principal and `identity.set()` still writes the caller's cookie.
//
// Mutating `outer.route` in place and restoring it was the obvious cheaper shape and is WRONG: a page
// firing eight reads concurrently is the documented case, and those reads would clobber each other's
// route between the set and the restore. Entering a scope is async-isolated (AsyncLocalStorage); a
// field assignment is not.
//
// `disposers` is pre-seeded on the outer scope so the copy SHARES the array: a middleware that registers
// a teardown must have it torn down by the request that owns the scope, and a shallow copy of an
// `undefined` field would give the copy its own array that nobody disposes.
function chainScope(outer: ReactiveScope | undefined, name: string, args: unknown): ReactiveScope {
    const route: RouteInfo = {
        kind: 'rpc',
        name,
        // `params` IS the args object for an rpc (`auth.md` §AU7 / `routeInfo.ts`), which is what makes a
        // per-args guard work identically from every door — and why a guard should key on this rather
        // than on `url`, the one field an in-process read cannot answer truthfully.
        params: args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {},
        url: chainUrl(outer, name, args),
        navigating: false,
    }
    if (outer === undefined) return { slots: new Map<string, unknown>(), route }
    if (outer.disposers === undefined) outer.disposers = []
    return { ...outer, route }
}

// The URL the read WOULD have arrived on, built the same way `channelAuth` builds it for a `@rpc:` join so
// the two non-HTTP doors describe the same read identically. The origin is the caller's when there is one;
// scope-free there is no request to take one from, and `RouteInfo.url` is not optional, so it is a
// stand-in — recorded here rather than left to be discovered by a middleware that trusted it.
function chainUrl(outer: ReactiveScope | undefined, name: string, args: unknown): URL {
    const origin = outer?.route?.url.origin ?? 'http://localhost'
    const url = new URL(`${RPC_ROUTE_PREFIX}${name}`, origin)
    if (args !== undefined) url.searchParams.set(RPC_QUERY_PARAMS.args, JSON.stringify(args))
    return url
}

// Run `produce` at the bottom of `middleware`, and return its value — unless a middleware short-circuited,
// in which case that Response becomes a THROW.
//
// The throw is what makes this usable from a value call at all: `rpc = memo + transport`, a memo's failure
// channel is a throw, and `toHttpError` is the same decoder the browser proxy uses on a non-2xx — so a
// middleware `error(403)` reaches an in-process caller as the identical `HttpError` a browser caller
// catches, and `fn.isError(e, name)` narrows the same on both.
async function throughChain<T>(
    middleware: Middleware[],
    produce: () => Promise<T>,
    read: { name: string; args: unknown },
): Promise<T> {
    if (middleware.length === 0) return produce()
    const outer = peekReactiveScope()
    let captured: T | undefined
    let produced = false
    const outcome = await enterScope(chainScope(outer, read.name, read.args), () =>
        compose(middleware, async (): Promise<Response> => {
            // THE READ RUNS IN THE CALLER'S SCOPE, not the override. The override exists for the
            // MIDDLEWARE; the read's memo slots, effect scopes and disposers belong to whoever asked for
            // it. Leaving `produce` inside the copy would file a scope-free read's slots in a throwaway
            // Map and a request's teardowns on an object nobody disposes.
            captured = await (outer === undefined ? exitScope(produce) : enterScope(outer, produce))
            produced = true
            return REACHED_TERMINAL
        })(),
    )
    // A middleware that returned its own response short-circuited. `produced` is checked too, so a
    // middleware that calls `next()` and then returns a DIFFERENT response is a short-circuit as well —
    // the read ran, but its value is not what the caller is owed.
    if (outcome !== REACHED_TERMINAL || !produced) throw await toHttpError(outcome)
    // `produced` is the witness that the assignment ran, so the cast is sound where `T` includes undefined.
    return captured as T
}
