// THE REQUEST SCOPE. What 11.32 files a value under on a server, what 22.1's ambients read, and —
// once there is an `App` — what `App.run` opens (42.7). One `AsyncLocalStorage`, because a request
// is carried across every `await` its handlers and bodies make, and an ambient read after one has
// to find the request it was made for.
//
// IMPORTING THIS MODULE IS WHAT MAKES A SERVER FILE VALUES. It fills the reactive core's provider
// slot (`#shared/reactive/scoping.ts`), so from here on a `reactive` built outside a request is a
// forwarder to one instance per request (`scoped.ts`). Everything that answers a request imports
// it, and it is imported before any app module is, which is what makes an app's module-level
// values forwarders rather than process-wide.

import { AsyncLocalStorage } from 'node:async_hooks' // bun implements AsyncLocalStorage and has no context-carrying api of its own
import { SCOPING, type Scope } from '#shared/reactive/scoping.ts'
import type { RpcRequest } from '#shared/rpcRequest.ts'

type RequestScope = Scope & {
    // `undefined` where the scope was opened without one — 42.8's scope, which 22.1 throws in.
    request: Request | undefined
    // 22.9 — what a write through `response` is collected onto, for whoever answers to apply.
    response: { status: number; headers: Headers }
    // 41.21 — the requests a page's render made, as the browser will make them, for the early-call
    // script. Empty in every scope but a page's.
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
    seed: Scope['seed'],
): RequestScope {
    return {
        instances: new Map(),
        seed,
        calls: [],
        request: given,
        response: { status: 200, headers: new Headers() },
    }
}

// One scope around `body`, and what `body` returned (42.7).
export function inScope<Result>(
    given: Request | undefined,
    body: () => Result,
): Result {
    return STORAGE.run(scopeFor(given, null), body)
}

// ONE SCOPE ACROSS EVERY PULL of what `open` hands back. A response body is pulled by the server's
// reader, which runs in no request at all, and a render builds its page on the first pull — so a
// scope opened around the call alone would be gone before any of the page ran.
//
// `seed` is where the calls made in it are reported (41.13) — a page's render passes one.
export async function* inScopeEachPull<Chunk>(
    given: Request,
    seed: Scope['seed'],
    open: () => AsyncGenerator<Chunk>,
): AsyncGenerator<Chunk> {
    const scope = scopeFor(given, seed)
    const chunks = STORAGE.run(scope, open)
    try {
        for (;;) {
            const step = await STORAGE.run(scope, () => chunks.next())
            if (step.done === true) return
            yield step.value
        }
    } finally {
        // A reader who hung up stops the render inside the scope it was running in.
        await STORAGE.run(scope, () => chunks.return(undefined))
    }
}

function within(name: string): RequestScope {
    const scope = STORAGE.getStore()
    if (scope?.request === undefined)
        throw new Error(
            `abide: ${name}() was called outside a request, and it reads the request being served. RULEBOOK 22.1.`,
        )
    return scope
}

// 22.1 — the request being served.
export function request(): Request {
    return within('request').request as Request
}

// 22.1, 22.9 — the response being built for it.
export function response(): { status: number; headers: Headers } {
    return within('response').response
}

// 41.21 — the requests the current page's render has made so far, for `render` to write into the
// early-call script once the page is set up. `undefined` outside a request.
export function earlyCalls(): RpcRequest[] | undefined {
    return STORAGE.getStore()?.calls
}
