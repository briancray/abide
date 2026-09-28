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

// 17.6 — the three framings a stream is answered in.
export type Framing = 'jsonl' | 'sse' | 'bytes'

export type RequestScope = Scope & {
    // 17.6 — the framing a helper fixed for a streaming answer, or `undefined` to negotiate it.
    framing: Framing | 'html' | undefined
    // 26.5 — which browser is calling, once read or minted in this request.
    caller: string | undefined
    // 26.14 — this request's one resolve of the principal.
    principal: Promise<Principal> | undefined
    // 16.24 — the longest `timeout` any handler that ran in this request asked for, in seconds, and
    // `Infinity` for one that is never reaped (16.62).
    timeout: number
    // 29.3 — this response's nonce, minted by the `csp` rung or on the first ask.
    nonce: string | undefined
    // 22.2 — this request's cookie jar, built on the first ask.
    cookies: Cookies | undefined
    // Whether an answer has taken what was written through `response` (`applyWritten`).
    applied: boolean
    // 24.1 — this scope's trace, built on the first ask (`trace.ts`).
    trace: { id: string; span: string; flags: string } | undefined
    // `undefined` where the scope was opened without one — 42.8's scope, which 22.1 throws in.
    request: Request | undefined
    // 16.23 — THE REQUEST THE LISTENER WAS HANDED, before a mount or a rung made another: bun raises
    // the idle timeout only on the one it received itself.
    received: Request | undefined
    // 22.9 — what a write through `response` is collected onto, for whoever answers to apply.
    response: { status: number; headers: Headers }
    // 41.13, 41.21 — the page this scope is rendering, which its calls report into; `undefined` in
    // every scope but a page's.
    page: PageRender | undefined
    // 21.15, 21.20, 24.6 — WHAT THE ANSWER'S `server-timing` CARRIES, gathered until the head goes out.
    timing: {
        entries: string[]
        // 21.20 — the time rungs took, apart from what they wrapped; `undefined` where none ran.
        middleware: number | undefined
        // The handler this request is answering, and its own body's time inside its rungs.
        answering: object | undefined
        handled: number | undefined
    }
}

// A PAGE'S RENDER, as its calls see it: the seed buffer's sink for this caller (41.13), and the
// requests the browser will make for them, for the early-call script (41.21). ON THE SCOPE because
// that is the only thing a call made deep in a page's setup can find it through when requests
// interleave — `RPC_SERVER.reached` is one slot for every request in flight.
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
        response: { status: 200, headers: new Headers() },
        timing: {
            entries: [],
            middleware: undefined,
            answering: undefined,
            handled: undefined,
        },
    }
}

// One scope around `body`, and what `body` returned (42.7).
export function inScope<Result>(
    given: Request | undefined,
    body: () => Result,
    received: Request | undefined = given,
): Result {
    return STORAGE.run(scopeFor(given, received), body)
}

// 37.3 — A RUNG MAY HAND `next` A REQUEST OF ITS OWN, and it is served in the scope `App.fetch`
// opened rather than a second one (42.6), so `request` reads it from here on.
export function adoptRequest(given: Request): void {
    ;(STORAGE.getStore() as RequestScope).request = given
}

// 42.9 — what `App.listen` bound, for `server` to hand back. 16.23 — and how a call raises the idle
// timeout on the request the listener received: on the server bound here, or where the listener is
// on another thread (`abide dev`), a message to it.
export const LISTENING: {
    server: Bun.Server<unknown> | undefined
    timeout: (received: Request, seconds: number) => void
} = {
    server: undefined,
    timeout: (received, seconds) =>
        LISTENING.server?.timeout(received, seconds),
}

// ONE SCOPE ACROSS EVERY PULL of what `open` hands back. A response body is pulled by the server's
// reader, which runs in no request at all, and a render builds its page on the first pull — so a
// scope opened around the call alone would be gone before any of the page ran.
//
// `page` is what the calls made in it report into (41.13) — a page's render passes one.
//
// THE SCOPE IS RESOLVED AT THE CALL, not on the first pull: a generator's body runs when it is first
// pulled, in whatever context the reader pulls from, and would miss the scope the request is
// answered in (42.6) — and with it the route and the `response` writes made before the page began.
export function inScopeEachPull<Chunk>(
    page: PageRender | undefined,
    open: () => AsyncGenerator<Chunk>,
): AsyncGenerator<Chunk> {
    const scope = STORAGE.getStore() as RequestScope
    scope.page = page
    return pullIn(scope, open)
}

async function* pullIn<Chunk>(
    scope: RequestScope,
    open: () => AsyncGenerator<Chunk>,
): AsyncGenerator<Chunk> {
    const chunks = STORAGE.run(scope, open)
    try {
        for (;;) {
            const step = await STORAGE.run(scope, pullNext, chunks)
            if (step.done === true) return
            yield step.value
        }
    } finally {
        // A reader who hung up stops the render inside the scope it was running in.
        await STORAGE.run(scope, closeEarly, chunks)
    }
}

const pullNext = <Chunk>(chunks: AsyncGenerator<Chunk>) => chunks.next()
const closeEarly = <Chunk>(chunks: AsyncGenerator<Chunk>) =>
    chunks.return(undefined)

// The scope a request or `App.run` opened, or `undefined` outside every one.
export function currentRequestScope(): RequestScope | undefined {
    return STORAGE.getStore()
}

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

// 21.10, 22.9 — WHAT WAS WRITTEN THROUGH `response`, onto the headers of an answer: over whatever
// the answer carried, and a `set-cookie` appended rather than replacing the one before it. ONCE, at
// `App.fetch`'s exit — the moment the head goes out, which is what `applied` tells 26.21.
export function applyWritten(headers: Headers): number {
    const scope = STORAGE.getStore()
    if (scope === undefined || scope.applied) return 200
    scope.applied = true
    for (const [name, value] of scope.response.headers)
        if (name === 'set-cookie') headers.append(name, value)
        else headers.set(name, value)
    return scope.response.status
}

// 22.9 — the status written through `response`, for a lane that builds its answer at it: 200 where
// nothing wrote one. The headers are laid over the answer once, at `App.fetch`'s exit (`applyWritten`).
export function writtenStatus(): number {
    return STORAGE.getStore()?.response.status ?? 200
}

// 22.1 — the request being served.
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

// 21.20 — time spent in rungs, or taken back out where it was the centre's.
export function rungsTook(duration: number): void {
    const timing = STORAGE.getStore()?.timing
    if (timing !== undefined)
        timing.middleware = (timing.middleware ?? 0) + duration
}

// 21.15, 24.6 — one `server-timing` metric, onto the answer `timing` belongs to.
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

// 21.15, 21.20, 24.6 — WHAT THE ANSWER CARRIES, in the order it was gathered; `undefined` for none.
export function serverTiming(): string | undefined {
    const timing = STORAGE.getStore()?.timing
    if (timing === undefined) return undefined
    const entries =
        timing.middleware === undefined
            ? timing.entries
            : [...timing.entries, metric('Middleware', timing.middleware)]
    return entries.length === 0 ? undefined : entries.join(', ')
}

// 22.1, 22.9 — the response being built for it.
export function response(): { status: number; headers: Headers } {
    return within('response').response
}

// 22.1, 42.9 — the listening server. Inside a request and with nothing bound — `App.fetch` on an
// app nobody called `listen` on — there is no server to hand back, and that is a throw too.
export function server<WebSocketData = unknown>(): Bun.Server<WebSocketData> {
    within('server')
    if (LISTENING.server === undefined)
        throw new Error(
            'abide: server() was called in an app with no socket bound. App.listen is what binds one. RULEBOOK 42.9.',
        )
    return LISTENING.server as Bun.Server<WebSocketData>
}
