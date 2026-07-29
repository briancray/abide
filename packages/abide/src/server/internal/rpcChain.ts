// THE MIDDLEWARE CHAIN AN RPC RUNS UNDER — one definition, and the adapter that lets a VALUE call run it.
//
// `middleware` is not just auth. It is `(next) => Response`: tracing, rate limiting, request-context
// population, response post-processing, and authorization. So a read that skips the chain is not merely
// unauthorized, it is unobserved — which is why an rpc's own middleware runs PER READ, wherever the read
// comes from, rather than only on the HTTP path.
//
// TWO RUNGS, AND THEY ARE NOT THE SAME QUESTION:
//
//   the rpc's OWN middleware — per READ, always. It is part of what the rpc's declaration means.
//   the GLOBAL chain (`config.middleware`) — per REQUEST. It runs when the caller is not already inside
//     a request that ran it.
//
// That distinction is not new; it is the rule `channelAuth` already follows for a WS subscribe (a socket
// join is not inside an HTTP request, so it runs both rungs) and the reason the router composes
// `[...global, ...own]` once around dispatch. Getting it wrong in the other direction is the failure worth
// naming: if the global chain re-ran per read, a page with eight reads would count NINE hits in a rate
// limiter and log nine request lines for one request.
//
// `currentScope()` is the discriminator, and it answers correctly for the cases that matter: it is defined
// during page SSR and inside a handler (the global chain has run — skip it), and undefined from a cron tick
// or any other scope-free caller inside a built app (nothing has run — run both).
//
// WHAT "EVERY DOOR" DOES NOT REACH, enumerated from the call sites rather than inferred. `bindChain` has one
// caller, `createApp`, so a door that builds no app is unchained: `abide run` boots through `appLifecycle`
// with `boot: () => undefined` and never calls `createApp`, and `bootApp` calls it INSIDE the `start()`
// thunk — so a migration, and an `onStart` warmer that reads before `await start()`, run NEITHER rung.
// `cli-lifecycle.md` CL2 states that for `run` deliberately, but it was written when the per-request rung
// was the only one; whether the per-READ rung should reach a migration is an open question, not a settled
// exemption. `fn.raw()` is the other gap and is by construction — it calls the handler, not `produce`.
//
// THE CHAIN RUNS IN THE CALLER'S SCOPE. Nothing here installs one, so the middleware's own ambients answer
// from wherever the read came from: at page SSR `route().kind` is `'nav'` and `route().name` is the page
// pattern, so a guard keyed on the rpc's NAME does not fire; scope-free, `route()`/`identity()`/`request()`
// throw. `channelAuth` is the one door that synthesizes an rpc-shaped scope before running this, and that
// asymmetry is deliberate only in the sense that nobody has decided it isn't.
//
// WHY THE CHAIN CANNOT MOVE INSIDE THE MEMO. The obvious shape — wrap the handler, i.e. the memo BODY — is
// wrong for authorization, and quietly: a memo coalesces by ARGS, not by identity, so two different
// principals reading the same args share one run and would share one middleware run with it. The first
// caller's authorization would stand in for the second's. The chain therefore wraps the CALL, outside the
// memo, and the memo still coalesces the work underneath it.

import { toHttpError } from '../../shared/internal/toHttpError.ts'
import type { AppConfig, Route } from './appConfig.ts'
import { compose, type Middleware } from './middleware.ts'
import { currentScope } from './requestScope.ts'

// The chain for one rpc. THE one definition: the router composes this around dispatch, `channelAuth`
// re-runs it per `@rpc:` channel join, and an in-process read runs it per call. It used to be spelled out
// at the first two sites independently (`router.ts` at mount, `channelAuth.ts` per subscribe), which is
// two places that had to agree about a list whose whole job is authorization.
//
// `includeGlobal` is the caller's answer to "has the global chain already run for this unit of work?".
export function rpcChainFor(route: Route, config: AppConfig, includeGlobal: boolean): Middleware[] {
    const own = route.__rpc.options.middleware ?? []
    if (!includeGlobal) return own
    const global = config.middleware ?? []
    // Allocating only when both rungs are non-empty keeps the common case (no per-rpc middleware) off the
    // spread path; the router's boot-time `routePolicy` still pre-derives its own copy once per route.
    if (own.length === 0) return global
    if (global.length === 0) return own
    return [...global, ...own]
}

// Does this caller still owe the global chain? Undefined scope = no request has run it (an `abide run`
// script, a cron tick, an `onStart` warmer). Inside a request — page SSR, a handler calling a sibling rpc —
// it has already run, and re-running it would double-count every per-request middleware.
export function owesGlobalChain(): boolean {
    return currentScope() === undefined
}

// The terminal's pass token. Compared by IDENTITY, never by status, for the same reason `channelAuth` and
// the socket upgrade gate do: a middleware may legitimately return its own 2xx, and returning ANY response
// instead of the terminal's IS the short-circuit.
const REACHED_TERMINAL = new Response(null, { status: 204 })

// Run `produce` at the bottom of `middleware`, and return its value — unless a middleware short-circuited,
// in which case that Response becomes a THROW.
//
// The throw is what makes this usable from a value call at all: `rpc = memo + transport`, a memo's failure
// channel is a throw, and `toHttpError` is the same decoder the browser proxy uses on a non-2xx — so a
// middleware `error(403)` reaches an in-process caller as the identical `HttpError` a browser caller
// catches, and `fn.isError(e, name)` narrows the same on both.
export async function throughChain<T>(
    middleware: Middleware[],
    produce: () => Promise<T>,
): Promise<T> {
    if (middleware.length === 0) return produce()
    let captured: T | undefined
    let produced = false
    const outcome = await compose(middleware, async (): Promise<Response> => {
        captured = await produce()
        produced = true
        return REACHED_TERMINAL
    })()
    // A middleware that returned its own response short-circuited. `produced` is checked too, so a
    // middleware that calls `next()` and then returns a DIFFERENT response is a short-circuit as well —
    // the read ran, but its value is not what the caller is owed.
    if (outcome !== REACHED_TERMINAL || !produced) throw await toHttpError(outcome)
    // `produced` is the witness that the assignment ran, so the cast is sound where `T` includes undefined.
    return captured as T
}
