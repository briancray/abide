// THE REQUEST SCOPE. What 11.32 files a value under on a server, what 22.1's ambients read, and
// what `App.run` opens (42.7). One `AsyncLocalStorage`, because a request
// is carried across every `await` its handlers and bodies make, and an ambient read after one has
// to find the request it was made for.
//
// IMPORTING THIS MODULE IS WHAT MAKES A SERVER FILE VALUES. It fills the reactive core's provider
// slot (`#shared/reactive/scoping.ts`), so from here on a `reactive` built outside a request is a
// forwarder to one instance per request (`scoped.ts`). Everything that answers a request imports
// it, and it is imported before any app module is, which is what makes an app's module-level
// values forwarders rather than process-wide.

import { AsyncLocalStorage } from 'node:async_hooks' // bun implements AsyncLocalStorage and has no context-carrying api of its own

import { Cookies } from '#shared/cookies.ts'
import type { Framed } from '#shared/framing.ts'
import type { Params } from '#shared/matchRoute.ts'
import type { Principal } from '#shared/principal.ts'
import { type Scope, SCOPING } from '#shared/reactive/scoping.ts'
import type { RpcRequest } from '#shared/rpcRequest.ts'

import type { McpSurface } from './generatedSurfaces.ts'
import { IDLE_TIMEOUT_SECONDS } from './IDLE_TIMEOUT_SECONDS.ts'

/** The three framings a stream is answered in. 17.6. */
export type Framing = Framed | 'bytes'

/** A principal cookie's claims, `exp` and `iat` aside, and when it lapses. 26.11. */
export type Sealed = { claims: Record<string, unknown>; expires: number }

/** What one request, or one `App.run`, carries across every `await` its work makes. */
export type RequestScope = Scope & {
    /**
     * What still answers this request: the opener, and a streamed body for as long as it streams.
     *
     * 12.5 — the scope is torn down when this reaches zero (`releaseScope`). A page is rendered
     * whole before its answer goes out, but a stream goes on reading in the scope after `fetch`
     * has returned, so it holds the scope until it closes.
     */
    holds: number
    /** The framing a helper fixed for a streaming answer, or `undefined` to negotiate it. 17.6. */
    framing: Framing | 'html' | 'json' | undefined
    /** Which browser is calling, once read or minted in this request. 26.5. */
    caller: string | undefined
    /** This request's one resolve of the principal. 26.14. */
    principal: Promise<Principal> | undefined
    /** What the principal cookie opened to once read, or `null` where it held no seal. */
    opened: Sealed | null | undefined
    /** 16.23 — whether the received request's idle timeout is off until the answer is sent. */
    unreaped: boolean
    /** This response's nonce, minted by the `csp` rung or on the first ask. 29.3. */
    nonce: string | undefined
    /** This request's cookie jar, built on the first ask. 22.2. */
    cookies: Cookies | undefined
    /** Whether an answer has taken what was written through `response` (`applyWritten`). */
    applied: boolean
    /** This scope's trace, built on the first ask (`trace.ts`). 24.1. */
    trace: { id: string; span: string; flags: string } | undefined
    /** `undefined` where the scope was opened without one — 42.8's scope, which 22.1 throws in. */
    request: Request | undefined
    /**
     * The route the request matched, once routing has run: the file route whose hooks answer it.
     *
     * 37.5 — which `onError` hooks an error in this request reaches.
     */
    route: string | undefined
    /** What that route matched in the address, for the answer its rungs reach (16.14). */
    params: Params | undefined
    /**
     * The app that opened this scope: the `App.fetch` `RPC_SERVER.raw` answers through, and its MCP
     * surface.
     *
     * 42.12 — ITS OWN APP, where two are held in one process: not whichever was built last.
     */
    app: AnsweringApp | undefined
    /**
     * The request the listener was handed, before a mount or a rung made another.
     *
     * 16.23 — bun sets the idle timeout only on the one it received itself.
     */
    received: Request | undefined
    /** What a write through `response` is collected onto, for whoever answers to apply. 22.9. */
    response: { status: number; headers: Headers }
    /**
     * The page this scope is rendering, which its calls report into.
     *
     * 41.13, 41.20 — `undefined` in every scope but a page's.
     */
    page: PageRender | undefined
    /**
     * What the answer's `server-timing` carries, gathered until the head goes out.
     *
     * 21.15, 21.20, 24.6.
     */
    timing: {
        entries: string[]
        /** The time rungs took, apart from what they wrapped; `undefined` where none ran. 21.20. */
        middleware: number | undefined
        /**
         * The handler this request is answering; `handled` is its own body's time inside its rungs.
         */
        answering: object | undefined
        handled: number | undefined
    }
}

/**
 * A page's render, as its calls see it: the seed sink and the requests the browser will make.
 *
 * The seed buffer's sink for this caller (41.13), and the requests the browser will make for the
 * calls, for the early-call script (41.20). ON THE SCOPE because that is the only thing a call made
 * deep in a page's setup can find it through when requests interleave — `RPC_SERVER.reached` is
 * one slot for every request in flight.
 */
export type PageRender = {
    seed: (rpc: object, args: unknown, reached: unknown) => boolean
    calls: PageCall[]
}

/** An app as the scopes it opens hold it: what answers a request in it, and its MCP surface. */
export type AnsweringApp = {
    answer: (request: Request) => Promise<Response>
    mcp: McpSurface
    /**
     * What this app's answers still hold past their request, each as what ends it: a streamed body
     * still being written, a seed entry and its timer. 42.11 — `App.stop` ends every one.
     */
    held: Set<() => void>
}

/**
 * One call a page's render made: the request the browser will make for it, what it reached, and
 * whether the markup was built from it settled — `undefined` until the pass that built from it
 * ends (41.25, `markPainted`).
 */
export type PageCall = {
    request: RpcRequest
    reached: unknown
    painted: boolean | undefined
}

// `undefined` IS A STORE, not the absence of one: a value built outside every request runs its body
// under it (`Cell.scope`), rather than under whichever request scheduled the drain.
const STORAGE = new AsyncLocalStorage<RequestScope | undefined>()

// AT IMPORT, unlike every slot `installServer` fills: `reactive` decides at CONSTRUCTION whether a
// value is filed per request (11.32), and a server module builds values as it loads — the
// principal's document here, an app's handlers ahead of `bootApp` in a compiled entry. Anything
// that can enter a scope imports this module, so none is built before the provider is in.
SCOPING.provider = {
    current: (): Scope | undefined => STORAGE.getStore(),
    run: (scope, body, given) =>
        STORAGE.run(scope as RequestScope | undefined, body, given),
}

/**
 * A fresh request scope, for an opener that enters it more than once (`inOpenScope`).
 *
 * 18.16 — a connection to the socket mux, whose every frame is answered in the scope its upgrade
 * opened; the opener releases it (`releaseScope`) when the connection closes, 18.17.
 */
export function scopeFor(
    given: Request | undefined,
    received: Request | undefined,
    app: RequestScope['app'],
): RequestScope {
    return {
        instances: new Map(),
        stops: [],
        holds: 1,
        page: undefined,
        trace: undefined,
        cookies: undefined,
        nonce: undefined,
        framing: undefined,
        unreaped: false,
        caller: undefined,
        principal: undefined,
        opened: undefined,
        applied: false,
        request: given,
        route: undefined,
        params: undefined,
        received,
        app,
        response: { status: 200, headers: new Headers() },
        timing: {
            entries: [],
            middleware: undefined,
            answering: undefined,
            handled: undefined,
        },
    }
}

/** Runs `body` in a fresh request scope and returns what it returned. 42.7. */
export function inScope<Result>(
    given: Request | undefined,
    body: () => Result,
): Result {
    return STORAGE.run(scopeFor(given, given, undefined), body)
}

/** Runs `body` in `scope`, which `scopeFor` opened, and returns what it returned. */
export function inOpenScope<Result>(
    scope: RequestScope,
    body: () => Result,
): Result {
    return STORAGE.run(scope, body)
}

/**
 * `inScope`, releasing the scope once `body` has settled.
 *
 * 12.5 — the watches `body` opened stop once it is done; a body still streaming holds the scope
 * until that closes (`holdScope`).
 */
export function inReleasedScope<Result>(
    given: Request | undefined,
    body: () => Promise<Result>,
    app: RequestScope['app'] = undefined,
    received: Request | undefined = given,
): Promise<Result> {
    const scope = scopeFor(given, received, app)
    // 16.23 — a request with no body is received whole as it arrives.
    if (received?.body === null) unreap(scope)
    return STORAGE.run(scope, async () => {
        try {
            return await body()
        } finally {
            releaseScope(scope)
        }
    })
}

/**
 * Holds the current request's scope open for an answer that outlives `fetch`; answers the release.
 *
 * 12.5 — A STREAMED BODY. Released once, when it closes, errors or its reader hangs up. Outside
 * every scope there is nothing to hold, and the release does nothing.
 */
export function holdScope(): () => void {
    const scope = STORAGE.getStore()
    if (scope === undefined) return () => {}
    scope.holds += 1
    let released = false
    return () => {
        if (released) return
        released = true
        releaseScope(scope)
    }
}

/**
 * Files `end` with the app answering the current scope, for `App.stop` to run; answers the unfiling.
 *
 * 42.11 — whatever outlives its request is the app's to end when it stops. Outside an app's scope
 * there is no stop to end it, and the unfiling does nothing.
 */
export function heldByApp(end: () => void): () => void {
    const held = STORAGE.getStore()?.app?.held
    if (held === undefined) return () => {}
    held.add(end)
    return () => {
        held.delete(end)
    }
}

/**
 * Lets go of one hold on `scope`; the last one tears it down.
 *
 * 12.5 — TEARDOWN STOPS EVERY `watch` OPENED IN IT, and their disposers run. Called by whatever
 * opened the scope to answer something — a request (`App.fetch`) or `App.run` — once that is
 * answered. A scope nothing releases lives as long as its process: the one `abide run` imports a
 * script in, whose watches are the script's to keep.
 */
export function releaseScope(scope: RequestScope): void {
    scope.holds -= 1
    if (scope.holds > 0) return
    // 16.56 — answered, the connection is reaped once idle again: set before bun writes an answer
    // that was not streamed, and as the last chunk of one that was goes out.
    if (scope.unreaped) {
        scope.unreaped = false
        LISTENING.timeout(scope.received as Request, IDLE_TIMEOUT_SECONDS)
    }
    const stops = scope.stops
    for (let at = 0; at < stops.length; at += 1) (stops[at] as () => void)()
    stops.length = 0
}

/**
 * Makes `given` the current scope's request, for a rung that handed `next` one of its own.
 *
 * 37.3 — A RUNG MAY HAND `next` A REQUEST OF ITS OWN, and it is served in the scope `App.fetch`
 * opened rather than a second one (42.6), so `request` reads it from here on.
 */
export function adoptRequest(given: Request): void {
    ;(STORAGE.getStore() as RequestScope).request = given
}

/**
 * Turns the received request's idle timeout off until its answer is sent (16.23), for a request
 * received whole. Where no request was received there is no connection to keep.
 *
 * WHOLE, NOT ARRIVED: a body still arriving is reaped as any idle connection is (16.56), so a caller
 * that stops sending partway is not held open for good.
 */
export function unreap(scope: RequestScope | undefined): void {
    if (scope === undefined || scope.received === undefined || scope.unreaped)
        return
    scope.unreaped = true
    // bun spells "never reaped" 0.
    LISTENING.timeout(scope.received, 0)
}

/**
 * What `App.listen` bound, and how the idle timeout is set on the received request.
 *
 * 42.9 — the server is for `server` to hand back. 16.23 — the timeout is set on the server bound
 * here, or where the listener is in another process (`abide dev`), by a message to it.
 */
export const LISTENING: {
    server: Bun.Server<unknown> | undefined
    timeout: (received: Request, seconds: number) => void
} = {
    server: undefined,
    timeout: (received, seconds) =>
        LISTENING.server?.timeout(received, seconds),
}

/**
 * Sets what the calls a render makes report into, on the request's own scope.
 *
 * 41.13 — set before the render runs: a page's render passes one, and an error page's none. The
 * render is awaited where the request is answered, so it runs in that scope throughout (42.6).
 */
export function beginRender(page: PageRender | undefined): void {
    ;(STORAGE.getStore() as RequestScope).page = page
}

/** The scope a request or `App.run` opened, or `undefined` outside every one. */
export function currentRequestScope(): RequestScope | undefined {
    return STORAGE.getStore()
}

/** The current request's scope; throws, naming `name()`, outside a request. 22.1. */
export function within(name: string): RequestScope {
    const scope = STORAGE.getStore()
    if (scope?.request === undefined)
        throw new Error(
            `abide: ${name}() was called outside a request, and it reads the request being served. RULEBOOK 22.1.`,
        )
    return scope
}

// 22.2, 22.8 — THE REQUEST'S JAR, whose writes are collected onto the response being built.
export function requestCookies(): Cookies {
    const scope = within('cookies')
    scope.cookies ??= new Cookies(
        scope.request?.headers.get('cookie') ?? '',
        (serialized) => {
            refuseUnanswered(scope, 'cookies().set')
            scope.response.headers.append('set-cookie', serialized)
        },
        false,
    )
    return scope.cookies
}

/**
 * Throws where nothing written now can reach an answer.
 *
 * 22.10 — ONCE THE HEADERS ARE OUT (`applyWritten`), and from the start on a connection to the
 * socket mux, whose headers went out with the upgrade: a write collected there is never sent.
 */
function refuseUnanswered(scope: RequestScope, name: string): void {
    if (scope.applied)
        throw new Error(
            `abide: ${name} was called after the response headers went out — or on a socket connection, whose headers went out with the upgrade — so what it writes cannot reach the browser. RULEBOOK 22.10.`,
        )
}

/**
 * Lays what was written through `response` onto `headers`, once; returns the written status.
 *
 * 21.10, 22.9 — over whatever the answer carried, and a `set-cookie` appended rather than
 * replacing the one before it. ONCE, at `App.fetch`'s exit — the moment the head goes out, which
 * is what `applied` tells 26.21.
 */
export function applyWritten(headers: Headers): number {
    const scope = STORAGE.getStore()
    if (scope === undefined || scope.applied) return 200
    scope.applied = true
    for (const [name, value] of scope.response.headers)
        if (name === 'set-cookie') headers.append(name, value)
        else headers.set(name, value)
    return scope.response.status
}

/**
 * The status written through `response`, or 200 where nothing wrote one.
 *
 * 22.9 — for a lane that builds its answer at it. The headers are laid over the answer once, at
 * `App.fetch`'s exit (`applyWritten`).
 */
export function writtenStatus(): number {
    return STORAGE.getStore()?.response.status ?? 200
}

/** The request being served. 22.1. */
export function request(): Request {
    return within('request').request as Request
}

// 21.20 — only the handler being answered: one it calls in process reports into the same scope.
export function handlerTook(rpc: object, duration: number): void {
    const timing = STORAGE.getStore()?.timing
    if (timing?.answering === rpc && timing.handled === undefined)
        timing.handled = duration
}

/**
 * Adds `duration` to the time spent in rungs.
 *
 * 21.20 — or takes it back out where it was the center's.
 */
export function rungsTook(duration: number): void {
    const timing = STORAGE.getStore()?.timing
    if (timing !== undefined)
        timing.middleware = (timing.middleware ?? 0) + duration
}

/** Adds one `server-timing` metric to the answer `timing` belongs to. 21.15, 24.6. */
export function timed(
    timing: RequestScope['timing'] | undefined,
    name: string,
    duration: number,
): void {
    timing?.entries.push(metric(name, duration))
}

function metric(name: string, duration: number): string {
    return `${name};dur=${duration.toFixed(1)}`
}

/**
 * The answer's `server-timing` header, in the order it was gathered; `undefined` for none.
 *
 * 21.15, 21.20, 24.6.
 */
export function serverTiming(): string | undefined {
    const timing = STORAGE.getStore()?.timing
    if (timing === undefined) return undefined
    const entries =
        timing.middleware === undefined
            ? timing.entries
            : [...timing.entries, metric('Middleware', timing.middleware)]
    return entries.length === 0 ? undefined : entries.join(', ')
}

/** The response being built for the request being served. 22.1, 22.9. */
export function response(): { status: number; headers: Headers } {
    const scope = within('response')
    refuseUnanswered(scope, 'response()')
    return scope.response
}

/**
 * The listening server.
 *
 * 22.1, 42.9 — inside a request and with nothing bound — `App.fetch` on an app nobody called
 * `listen` on — there is no server to hand back, and that is a throw too.
 */
export function server<WebSocketData = unknown>(): Bun.Server<WebSocketData> {
    within('server')
    if (LISTENING.server === undefined)
        throw new Error(
            'abide: server() was called in an app with no socket bound. App.listen is what binds one. RULEBOOK 42.9.',
        )
    return LISTENING.server as Bun.Server<WebSocketData>
}
