// 11.32 — WHERE A VALUE IS FILED. A `reactive` without `global` is request-local on a server and
// process-local in a browser, and this module is the whole of how the reactive core tells the two
// apart: a PROVIDER the server installs, and nothing at all in a browser.
//
// A SLOT RATHER THAN AN IMPORT. The scope a server keeps is an `AsyncLocalStorage`, which this seam
// cannot name — a browser bundle that reached `node:async_hooks` would not build. So the server
// fills `SCOPING.provider` (`#server/requestScope.ts`) and the core asks the slot, and a browser,
// where nothing fills it, pays one load of a `null` wherever the core asks.

export type Scope = {
    // One instance per value filed OUTSIDE any scope and reached inside this one — see `scoped.ts`.
    // A `Map` rather than a `WeakMap` because the scope is the shorter life: it is dropped with its
    // request, and everything it holds goes with it.
    instances: Map<object, unknown>
}

export type Scoping = {
    current(): Scope | undefined
    // Runs `body` with `scope` as the current one, and `undefined` as no scope at all. A body is run
    // under the scope its value was built in rather than the ambient one, because the ambient one
    // is whichever request scheduled the drain the body is running in.
    run<Given, Result>(
        scope: Scope | undefined,
        body: (given: Given) => Result,
        given: Given,
    ): Result
}

export const SCOPING: { provider: Scoping | null } = { provider: null }

export function currentScope(): Scope | undefined {
    const provider = SCOPING.provider
    return provider === null ? undefined : provider.current()
}

// `body` under `scope` — called straight through where there is no provider, or where `scope` is
// already the current one, which inside a render it almost always is.
export function runInScope<Given, Result>(
    scope: Scope | undefined,
    body: (given: Given) => Result,
    given: Given,
): Result {
    const provider = SCOPING.provider
    return provider === null || provider.current() === scope
        ? body(given)
        : provider.run(scope, body, given)
}
