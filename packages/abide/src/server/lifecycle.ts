// The app's lifecycle: the four hooks a process has, and the two functions that run them.
//
// A REGISTRATION is the primitive and the module export is sugar over it: `abide dev` and `abide
// start` import an app's module and hand each export to the function of the same name — the `HOOKS`
// table in `cli/internal/layers.ts`, which covers `onHealth` and `onIdentity` too. So an app run by
// the binary and a hand-written entry point that registers them itself mean the same thing, and
// nothing here waits for a bundler: a boot is a socket and four hooks, and only one needs a build.
//
// Three of the four are onions, and each is an onion for the same reason: the interesting hook is
// the one that does something on BOTH sides of the thing it wraps. `onStart` binds the socket inside
// itself, so an app cannot serve a request before its migrations ran; `onStop` drains before the
// socket closes; a middleware rung sees the request going down and the response coming back. A pair
// of before/after hooks cannot express any of that without a variable held between them.

import type { Server } from 'bun'
import { isThenable, messageOf } from '$shared/internal/probes.ts'
import { abideLog } from '$shared/log.ts'
import { config } from './config.ts'
import { dispatch } from './registry.ts'
import { failed, HttpError } from './responses.ts'
import { server as running } from './running.ts'
import { serveIfScoped } from './scopes.ts'

const lifecycleLog = abideLog.channel('lifecycle')
// One line per request, and the only place in abide that sees every one of them: `handle` is the
// funnel, so this covers an app's own routes and everything under `/__abide/` alike. An app that
// mounted `dispatch` by hand instead is outside it, and gets the per-lane lines and no request line.
const requestLog = abideLog.channel('request')

/**
 * One rung of the per-request onion. `next()` takes no arguments, like every other chain in abide.
 *
 * Short-circuited by returning a `Response` without calling `next()`, or by throwing — which is the
 * whole of how an auth rung refuses, since `error(401)` throws and the throw is already
 * carried to a status by the same path a handler's is.
 */
export type Middleware = (next: () => Promise<Response>) => Response | Promise<Response>

/** WRAPS the boot: do the setup, then `await start()`. The socket binds inside it and nowhere else. */
export type StartHook = (start: () => Promise<void>) => void | Promise<void>

/** Mirrors `StartHook` for teardown: drain, then `await stop()`. Backstopped if it never does. */
export type StopHook = (stop: () => Promise<void>) => void | Promise<void>

/**
 * What an UNEXPECTED failure means. A `Response` is the answer sent; anything else falls through to
 * the ordinary 500, so a hook that only wants to report one returns nothing.
 */
export type ErrorHook = (error: unknown) => unknown

/** What an app's own routes are: a `Response`, or nothing when the path was not one of theirs. */
export type Route = (
    request: Request,
    server: Server<never>,
) => Response | Promise<Response | undefined> | undefined

// Empty rather than null, because the read is per REQUEST: `RUNGS.length === 0` is one property load
// on the hot path, where a null check plus a length would be two.
let RUNGS: Middleware[] = []
let STARTING: StartHook | null = null
let STOPPING: StopHook | null = null
let FAILING: ErrorHook | null = null

/**
 * Register app-level rungs, outermost first. Returns the way back off.
 *
 * APPENDS where `onStart` and the other three REPLACE, and the asymmetry is the shape of the export
 * rather than an inconsistency: `middleware` is declared as an array because a chain is plural, so
 * two registrations are two rungs in call order. There is one boot, one teardown and one account of
 * a failure, so a second registration of any of those is a correction rather than an addition.
 */
export function middleware(...rungs: Middleware[]): () => void {
    if (rungs.length === 0) return noop
    RUNGS = RUNGS.concat(rungs)
    return () => {
        // Only the ones this call added, and matched by identity: another registration may have
        // landed between, and taking the whole chain off would be this disposer reaching past its
        // own rungs.
        const kept: Middleware[] = []
        for (const rung of RUNGS) if (!rungs.includes(rung)) kept.push(rung)
        RUNGS = kept
    }
}

/** The app's own boot, wrapped around abide's. Returns the way back off. */
export function onStart(hook: StartHook): () => void {
    STARTING = hook
    return () => {
        if (STARTING === hook) STARTING = null
    }
}

/** The app's own teardown, wrapped around abide's. Returns the way back off. */
export function onStop(hook: StopHook): () => void {
    STOPPING = hook
    return () => {
        if (STOPPING === hook) STOPPING = null
    }
}

/** What an unexpected failure means to this app. Returns the way back off. */
export function onError(hook: ErrorHook): () => void {
    FAILING = hook
    return () => {
        if (FAILING === hook) FAILING = null
    }
}

function noop(): void {}

// --- one request -------------------------------------------------------------

/**
 * The app's routes, with abide's endpoints in front of them and the app's own onion around them.
 *
 * `fetch: handle(routes)` is the whole wiring. What it adds to a bare `fetch` is the four things an
 * app would otherwise write at every entry point and forget at one: the request scope every ambient
 * answers off, `/__abide/**`, the middleware chain, and one rule for a route that throws.
 *
 * The onion is around the APP's routes rather than around the whole request, and that is a
 * consequence rather than a convenience. A websocket upgrade has no response — Bun answers the
 * handshake itself — so a rung wrapping one could not keep the `Promise<Response>` its own signature
 * promises. Everything under the reserved prefix already gates itself per DECLARATION anyway:
 * `GET(fn, { middleware })` and `socket({ middleware })` are the rungs for a call and a subscribe,
 * and they see the args and the room, which an onion over the raw request never could.
 */
export function handle(route: Route): (request: Request, server: Server<never>) => ReturnType<Route> {
    return (request: Request, server: Server<never>): ReturnType<Route> =>
        serveIfScoped(request, () => routed(request, server, route))
}

/**
 * The request, and the one line that reports it.
 *
 * The gate is asked before the CLOCK: a closed channel never reads `performance.now()`, never parses
 * the URL and never attaches the `.then` that observes the answer, so an app with `DEBUG` unset pays
 * one spec read per request for this existing. That branch is the whole reason `enabled()` is on the
 * logger — the message interpolates four values, and an argument is built before the gate can refuse
 * it.
 */
function routed(request: Request, server: Server<never>, route: Route): ReturnType<Route> {
    if (!requestLog.enabled()) return answering(request, server, route)
    const started = performance.now()
    const answered = answering(request, server, route)
    if (!isThenable(answered)) {
        said(request, answered, started)
        return answered
    }
    return answered.then((settled) => {
        said(request, settled, started)
        return settled
    })
}

/** What was asked, what answered, and how long it took — inside the scope, so it carries the trace. */
function said(request: Request, answered: Response | undefined, started: number): void {
    // `undefined` is a socket that upgraded: Bun answered the handshake itself, so there is no status
    // to report and reporting a 101 would be this file inventing one nothing sent.
    const outcome = answered === undefined ? 'upgraded' : answered.status
    const elapsed = (performance.now() - started).toFixed(1)
    requestLog.debug(`${request.method} ${new URL(request.url).pathname} ${outcome} ${elapsed}ms`)
}

function answering(request: Request, server: Server<never>, route: Route): ReturnType<Route> {
    // Synchronously `undefined` for anything outside `/__abide/`, so an app's own routes pay one
    // string comparison. A PROMISE of `undefined` is a socket that upgraded, and Bun wants that
    // undefined handed straight back — which is why the two are told apart by their shape.
    // Cast because `dispatch` names the socket data it attaches at upgrade and this does not: the
    // shape is the registry's own, and an app's `fetch` is handed Bun's server before anything has
    // decided what a connection carries.
    //
    // Guarded for a SYNCHRONOUS throw only, and the asymmetry is the cost: every lane under
    // `/__abide/` already turns its own failure into a response — rpc through `failed`, identity
    // through its anonymous floor — so a rejection out of here is an abide bug rather than an app's,
    // and a `.catch` to carry one would put a promise and a tick on every rpc call in exchange. The
    // try is free when nothing throws, which is what makes the near half worth guarding at all.
    try {
        const abide = dispatch(request, server as never)
        // Handed straight back, and deliberately without a `.catch`: a rejection out of `dispatch` is
        // an abide bug rather than an app's, and one that upgraded a socket has no response to carry.
        if (abide !== undefined) return abide

        const rungs = RUNGS
        const settled =
            rungs.length === 0
                ? settle(route(request, server), request)
                : onion(rungs, 0, request, server, route)
        return isThenable(settled) ? settled.catch(failing) : settled
    } catch (failure) {
        return failing(failure)
    }
}

/**
 * The app answered, or it did not. Guarded, because the ordinary route returns in the call.
 *
 * The undefined-is-404 rule and nothing else: a throw is left to propagate so that the rung it
 * passes on its way out can be the one that answers it, which is what `next()` returning a promise
 * is for. `routed` attaches `failing` at whichever end of the chain the request actually took.
 */
function settle(answered: ReturnType<Route>, request: Request): Response | Promise<Response> {
    if (answered === undefined) return notFound(request)
    if (!isThenable(answered)) return answered
    return answered.then((settled) => settled ?? notFound(request))
}

/**
 * Rung `at`, with the rest of the chain behind it.
 *
 * `next()` is declared to return a `Promise<Response>`, so the innermost call is wrapped even when
 * the route answered in the call. That cost is the signature's and it is only paid by an app that
 * declared a rung at all — the branch above runs the route directly when the chain is empty, which
 * is every app that has not asked for one.
 */
function onion(
    rungs: Middleware[],
    at: number,
    request: Request,
    server: Server<never>,
    route: Route,
): Promise<Response> {
    if (at >= rungs.length) return Promise.resolve(settle(route(request, server), request))
    const rung = rungs[at] as Middleware
    let entered = false
    const next = (): Promise<Response> => {
        if (entered) {
            // Two `next()` calls in one rung is two runs of everything under it — a duplicated
            // mutation, not a duplicated read. Named here rather than discovered as a request that
            // charged a card twice.
            return Promise.reject(new Error('abide: a middleware rung called next() more than once'))
        }
        entered = true
        return onion(rungs, at + 1, request, server, route)
    }
    // `resolve` rather than an `async` wrapper: a rung that short-circuits with a plain `Response`
    // is the common refusal, and this is the one place its answer is adapted to the chain's type.
    return Promise.resolve(rung(next))
}

/**
 * A route that threw.
 *
 * An `HttpError` is a DELIBERATE outcome — `error(404, 'no user')` is a guard an author wrote — so it
 * answers with what it says and never reaches `onError`. A hook that ran for every `error(...)` call
 * would be one an app has to filter, and the filter would be this test written a second time.
 */
function failing(failure: unknown): Response {
    if (failure instanceof HttpError) return failed(failure.kind, failure.message, failure.status)

    const hook = FAILING
    if (hook !== null) {
        try {
            const answered = hook(failure)
            if (answered instanceof Response) return answered
        } catch (inside) {
            // The hook is where an app says what a failure MEANS, so one that fails itself has
            // nowhere else to be reported — and swallowing it would leave two failures behind one
            // 500. Never gated: the `DEBUG` gate controls volume, not breakage.
            lifecycleLog.error(`onError threw: ${messageOf(inside)}`)
        }
    }
    const said = messageOf(failure)
    // Said on abide's own channel whether or not the app took the hook, because a 500 whose cause
    // appears nowhere is the one failure an operator cannot act on.
    lifecycleLog.error(said)
    return failed('AbideRouteError', said, 500)
}

// Parsed here, where `registry.ts` goes out of its way not to per request: this runs only once a 404
// is already being BUILT, and the URL costs a fraction of the Response and the JSON body beside it.
function notFound(request: Request): Response {
    return failed('AbideRouteError', `nothing is served at ${new URL(request.url).pathname}`, 404)
}

// --- the process -------------------------------------------------------------

// What `shutdown` has to stop, and what makes `server()` answerable before the first request rather
// than from it. Held here rather than read back off `running`, because a teardown must work for an
// app whose `bind` returned something that is not a Bun server at all.
let BOUND: { stop: (closeActiveConnections?: boolean) => unknown } | null = null
let STOPPED: Promise<void> | null = null
let SIGNALLED = false

/**
 * Boot this process: run the app's `onStart` around `bind`, and hand back what `bind` made.
 *
 * `bind` is the socket — `boot(() => Bun.serve({ … }))` — and it runs INSIDE the hook rather than
 * before it, which is the whole reason `onStart` wraps instead of preceding. An app whose setup is
 * `await migrate()` cannot take a request against a schema that is halfway migrated, and there is no
 * ordering of two separate hooks that gives it that.
 *
 * Returns `null` for a hook that returned without calling `start()`. That is a BREAKOUT rather than
 * a bug — a hook that decided this process should not serve is an app saying so — so it is an
 * answer a caller can read, said once on `abide:lifecycle` in case it was not deliberate.
 */
export async function boot<T>(bind: () => T | Promise<T>): Promise<T | null> {
    // FIRST, and before the hook that could ask for it. A process that cannot be configured must not
    // reach a socket: `onConfig` throwing here is a boot that rejects, where the same throw on the
    // first read would be a 500 on whichever request happened to need the missing key — long after
    // the deploy that shipped without it looked like it had worked.
    //
    // Unconditional, because every knob abide reads is answered from this document. The floor's
    // package.json read and the first touch of `process.stdout` are paid HERE, once, at the moment a
    // process is starting anyway — rather than by whichever request happened to open the first
    // stream. A `boot` is exactly where a startup cost belongs.
    config()

    const hook = STARTING
    let bound: T | null = null
    let started = false

    const start = async (): Promise<void> => {
        // A hook that calls `start()` twice is asking for two sockets on one port. The second call
        // is the same await as the first rather than a second bind.
        if (started) return
        started = true
        const made = bind()
        bound = isThenable(made) ? await made : made
        latch(bound)
    }

    if (hook === null) await start()
    else {
        const running = hook(start)
        if (isThenable(running)) await running
    }

    if (!started) {
        lifecycleLog.warning('onStart returned without calling start() — nothing is listening')
        return null
    }
    // Only when something was bound that can be CLOSED. Adding a SIGINT handler is what stops the
    // default from terminating, so a boot with nothing to shut down would take Ctrl-C away from
    // whoever owned it — a test runner, a REPL — in order to run an empty teardown.
    if (BOUND !== null) listen()
    return bound
}

/**
 * Hold what was bound, and hand a Bun server to `server()` while we are at it.
 *
 * Probed rather than typed, because `bind` is whatever the app returned: a test that binds nothing
 * still gets the rest of the lifecycle, and a `Server` is recognised by the two methods this needs
 * from it rather than by an import that would make the check a compile-time claim about a runtime
 * value.
 */
function latch(bound: unknown): void {
    if (bound === null || typeof bound !== 'object') return
    const candidate = bound as { stop?: unknown; reload?: unknown }
    if (typeof candidate.stop !== 'function') return
    BOUND = bound as { stop: () => unknown }
    if (typeof candidate.reload === 'function') running.set(bound as Server<never>)
}

/**
 * Tear this process down: run the app's `onStop` around the socket closing.
 *
 * Backstopped, unlike `boot`. The asymmetry is deliberate: a hook that never calls `start()` has
 * said the app should not serve, and there is nothing harmful about that. A hook that never calls
 * `stop()` has said nothing — it drained and returned — and a process that then goes on listening
 * through its own SIGTERM is the failure a teardown exists to prevent.
 *
 * Idempotent while it is IN FLIGHT: SIGINT twice, or a signal arriving during a deliberate call, is
 * one teardown that both callers await. The latch is cleared once that teardown finishes rather than
 * held for the life of the process — a second call after the first completed is a second teardown,
 * which is the only reading that lets something which bound a socket again close it again.
 */
export function shutdown(): Promise<void> {
    if (STOPPED !== null) return STOPPED
    const running = tearDown().finally(() => {
        if (STOPPED === running) STOPPED = null
    })
    STOPPED = running
    return running
}

async function tearDown(): Promise<void> {
    const hook = STOPPING
    let closed = false
    const stop = async (): Promise<void> => {
        if (closed) return
        closed = true
        const held = BOUND
        BOUND = null
        if (held !== null) await held.stop()
    }

    if (hook !== null) {
        try {
            const running = hook(stop)
            if (isThenable(running)) await running
        } catch (failure) {
            // A drain that failed is still a process on its way out, so the socket closes either way
            // — that is what the backstop below is, and a throw must not be what skips it.
            lifecycleLog.error(`onStop threw: ${messageOf(failure)}`)
        }
    }
    // The backstop, and the ordinary close for an app with no hook at all: `stop` is idempotent, so
    // one line answers both rather than the hookless path having a close of its own.
    await stop()
}

/**
 * SIGINT, SIGTERM, and the two ways a process crashes.
 *
 * Installed by `boot` rather than at import, so importing `abide/server` never takes a signal away
 * from whoever owned it — a test runner, a REPL, a script that only wanted `renderToString`. Once
 * per process, because a second `boot` is a second server and not a second lifecycle.
 *
 * The exit is ours to make once a handler exists: adding one to SIGINT is what stops the default
 * from terminating, so a process that only drained would sit there ignoring its own Ctrl-C.
 */
function listen(): void {
    if (SIGNALLED) return
    SIGNALLED = true
    // Through `unknown` because the global is typed here and narrower than what this needs: a
    // browser build of `abide/server` has a `process` shim with none of these on it, and the whole
    // point of the probe is to find that out at runtime rather than to assert it at compile time.
    const process = (globalThis as { process?: unknown }).process as NodeProcess | undefined
    if (process === undefined || typeof process.on !== 'function') return

    const signalled = (signal: string): void => {
        lifecycleLog.debug(`${signal} — stopping`)
        void shutdown().then(() => process.exit?.(0))
    }
    process.on('SIGINT', () => signalled('SIGINT'))
    process.on('SIGTERM', () => signalled('SIGTERM'))

    const crashed = (failure: unknown): void => {
        // Not `onError`'s: that hook is request-scoped, and what reaches here escaped every request
        // there was. This is the process ending, and the line is what says why.
        lifecycleLog.error(`unhandled: ${messageOf(failure)}`)
        void shutdown().then(() => process.exit?.(1))
    }
    process.on('uncaughtException', crashed)
    process.on('unhandledRejection', crashed)
}

/** Just the two members of `process` this file touches, so nothing here needs `@types/node`. */
interface NodeProcess {
    on?: (event: string, listener: (argument: never) => void) => unknown
    exit?: (code: number) => never
}
