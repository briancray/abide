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
import { COOKIES, Cookies } from '#shared/cookies.ts'
import type { Principal } from '#shared/principal.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import { SCOPING, type Scope } from '#shared/reactive/scoping.ts'
import type { RpcRequest } from '#shared/rpcRequest.ts'

/** The three framings a stream is answered in. 17.6. */
export type Framing = 'jsonl' | 'sse' | 'bytes'

/** What one request, or one `App.run`, carries across every `await` its work makes. */
export type RequestScope = Scope & {
    /** The framing a helper fixed for a streaming answer, or `undefined` to negotiate it. 17.6. */
    framing: Framing | 'html' | undefined
    /** Which browser is calling, once read or minted in this request. 26.5. */
    caller: string | undefined
    /** This request's one resolve of the principal. 26.14. */
    principal: Promise<Principal> | undefined
    /**
     * The longest `timeout` any handler that ran in this request asked for, in seconds.
     *
     * 16.24 — and `Infinity` for one that is never reaped (16.62).
     */
    timeout: number
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
     * The `App.fetch` of the app that opened this scope, which `RPC_SERVER.raw` answers through.
     *
     * 42.12 — ITS OWN APP, where two are held in one process: not whichever was built last.
     */
    answer: ((request: Request) => Promise<Response>) | undefined
    /**
     * The request the listener was handed, before a mount or a rung made another.
     *
     * 16.23 — bun raises the idle timeout only on the one it received itself.
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
    calls: RpcRequest[]
}

// `undefined` IS A STORE, not the absence of one: a value built outside every request runs its body
// under it (`Cell.scope`), rather than under whichever request scheduled the drain.
const STORAGE = new AsyncLocalStorage<RequestScope | undefined>()

SCOPING.provider = {
    current: (): Scope | undefined => STORAGE.getStore(),
    run: (scope, body, given) =>
        STORAGE.run(scope as RequestScope | undefined, body, given),
}

function scopeFor(
    given: Request | undefined,
    received: Request | undefined,
    answer: RequestScope['answer'],
): RequestScope {
    return {
        instances: new Map(),
        page: undefined,
        trace: undefined,
        cookies: undefined,
        nonce: undefined,
        framing: undefined,
        timeout: 0,
        caller: undefined,
        principal: undefined,
        applied: false,
        request: given,
        received,
        answer,
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
    answer: RequestScope['answer'] = undefined,
    received: Request | undefined = given,
): Result {
    return STORAGE.run(scopeFor(given, received, answer), body)
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
 * What `App.listen` bound, and how a call raises the idle timeout on the received request.
 *
 * 42.9 — the server is for `server` to hand back. 16.23 — the timeout is raised on the server
 * bound here, or where the listener is in another process (`abide dev`), by a message to it.
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
COOKIES.current = (): Cookies => {
    const scope = within('cookies')
    scope.cookies ??= new Cookies(
        scope.request?.headers.get('cookie') ?? '',
        (serialized) => scope.response.headers.append('set-cookie', serialized),
        false,
    )
    return scope.cookies
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

// 16.12 — the request a handler's rung is handed.
RPC_SERVER.request = request

// 21.20 — only the handler being answered: one it calls in process reports into the same scope.
RPC_SERVER.handled = (rpc, duration) => {
    const timing = STORAGE.getStore()?.timing
    if (timing?.answering === rpc && timing.handled === undefined)
        timing.handled = duration
}

/**
 * Adds `duration` to the time spent in rungs.
 *
 * 21.20 — or takes it back out where it was the centre's.
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
    return within('response').response
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
