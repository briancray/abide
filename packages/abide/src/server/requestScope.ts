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
import { settingUp } from '#shared/reactive/watch.ts'

import { fileIfLoading } from './filedLoads.ts'
import type { Followers } from './Followers.ts'
import type { McpSurface } from './generatedSurfaces.ts'
import { IDLE_TIMEOUT_SECONDS } from './IDLE_TIMEOUT_SECONDS.ts'
import type { PageRender } from './PageRender.ts'

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
     * The page this scope is rendering, which its calls report into (`PageRender.ts`).
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

/** An app as the scopes it opens hold it: what answers a request in it, and its MCP surface. */
export type AnsweringApp = {
    answer: (request: Request) => Promise<Response>
    mcp: McpSurface
    /**
     * What this app's answers still hold past their request, each as what ends it: a streamed body
     * still being written, a seed entry and its timer. 42.11 — `App.stop` ends every one.
     */
    held: Set<() => void>
    /** Every subscription to this app's handlers, over its mux or as an event stream. 18.3. */
    followers: Followers
}

// `undefined` IS A STORE, not the absence of one: a value built outside every request runs its body
// under it (`Cell.scope`), rather than under whichever request scheduled the drain.
const STORAGE = new AsyncLocalStorage<RequestScope | undefined>()

// AT IMPORT, unlike every slot `installServer` fills: `reactive` decides at CONSTRUCTION whether a
// value is filed per request (11.32), and a server module builds values as it loads — the
// principal's document here, an app's handlers ahead of `bootApp` in a compiled entry. Anything
// that can enter a scope imports this module, so none is built before the provider is in.
// 22.11 — A RENDER OUTSIDE EVERY REQUEST IS STILL A SERVER'S: `render` called bare, and `mount`'s
// first half, which a test process runs beside a DOM and the browser half that hydrates it. Marked
// apart from STORAGE so the render's values stay the ones 11.32 files outside a request. What it
// holds is the render's stops (12.5): a request's are its scope's.
const RENDERING = new AsyncLocalStorage<(() => void)[]>()

/** The stops of the request or the render current, or `undefined` where neither is. */
function currentStops(): (() => void)[] | undefined {
    return STORAGE.getStore()?.stops ?? RENDERING.getStore()
}

SCOPING.provider = {
    current: (): Scope | undefined => STORAGE.getStore(),
    serverStops: currentStops,
    run: (scope, body, given) =>
        STORAGE.run(scope as RequestScope | undefined, body, given),
    // 41.35 — A MODULE'S DECLARATION, which a component's own value is not: one built in a render
    // outside every request, or in a setup — a browser half mounted in a test process the server's
    // modules are loaded in — is no declaration to build again in every render after it.
    filed: (forwarder) => {
        if (currentStops() === undefined && !settingUp())
            fileIfLoading(forwarder)
    },
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

/**
 * Runs `body` as a server's render, stopping every watch it opened once it has settled.
 *
 * 12.5 — A RENDER OUTSIDE EVERY REQUEST IS TORN DOWN as a request's scope is, once its document is
 * written. Inside a request or a render already open, the watches are that one's to stop.
 */
export function inReleasedRender<Result>(
    body: () => Promise<Result>,
): Promise<Result> {
    // A REQUEST'S PAGE PAYS NOTHING HERE — no wrapping promise, no tick — as its scope stops them.
    if (currentStops() !== undefined) return body()
    const stops: (() => void)[] = []
    return RENDERING.run(stops, body).finally(() => stopAll(stops))
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
    stopAll(scope.stops)
}

/** Runs and drops every stop in `stops`. 12.5. */
function stopAll(stops: (() => void)[]): void {
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

/**
 * The response being built for the request being served, read by `name` (`response.ts`), which
 * a throw names. 22.1, 22.9.
 */
export function responseWritten(name: string): {
    status: number
    headers: Headers
} {
    const scope = within(name)
    refuseUnanswered(scope, `${name}()`)
    return scope.response
}

/** Where a request came from: a peer's address, `null` where the listener names none. */
export type ReceivedFrom = {
    address: string
    family: 'IPv4' | 'IPv6'
    port: number
} | null

/**
 * The peer each request a listener received came from, keyed by the request it handed the app.
 *
 * 22.12 — FILED BY THE LISTENER: `App.listen` files what bun names, and `abide dev`'s worker what its
 * listener sent beside the request (38.14). A request nobody filed was made in process.
 */
export const RECEIVED_FROM = new WeakMap<Request, ReceivedFrom>()

/**
 * The address the request being served came from, or `'in-process'` for one no listener received.
 *
 * 22.12, 22.13 — the same under `abide start`, `abide dev` and `App.listen`; `null` where the
 * listener names no peer, as a unix socket does. A socket mux frame answers its upgrade's.
 */
function ip(): ReceivedFrom | 'in-process' {
    const scope = within('request.ip')
    const asked = (scope.received ?? scope.request) as Request
    return RECEIVED_FROM.has(asked)
        ? (RECEIVED_FROM.get(asked) as ReceivedFrom)
        : 'in-process'
}

/**
 * The user agent of the request being served, or '' outside one — 38.141's, which answers
 * `undefined` there rather than throwing as `request()` does. A socket mux frame answers its
 * upgrade's, as `ip` does.
 */
export function requestAgent(): string {
    const scope = STORAGE.getStore()
    const asked = scope?.received ?? scope?.request
    return asked?.headers.get('user-agent') ?? ''
}

/** The request being served. 22.1. */
function requestBeingServed(): Request {
    return within('request').request as Request
}

/** The request being served, and where it came from. 22.1, 22.12. */
export const request: typeof requestBeingServed & { ip: typeof ip } =
    Object.assign(requestBeingServed, { ip })

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
