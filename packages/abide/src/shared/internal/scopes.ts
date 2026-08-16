// Per-caller storage: the thing that makes a module-level `memo` safe on a server.
//
// A `memo` declared at module scope is created ONCE, at import, and its cache lives for the life of
// the process. On a client that is exactly right — there is one caller, forever. On a server it means
// the answer to "who am I?" computed for one request is served to the next one, which is not a cache
// bug, it is a data leak. So a memo's STORAGE is per-caller by default and `{ global }` is how a
// caller asks for the process-wide slot the spec describes.
//
// Nothing here imports `node:async_hooks`. The default source is one plain variable, which is correct
// wherever calls do not interleave — a client, a test, a script. A server REPLACES the source with an
// async-local one, because a request's scope has to survive an `await` while other requests run. That
// keeps the browser bundle free of an AsyncLocalStorage shim it would never use, and it is what makes
// the unscoped read below a single null check rather than a lookup.

import { isThenable } from './probes.ts'

export interface Scope {
    /** owner -> whatever that owner keeps for this caller. */
    stores: Map<object, unknown>
    /** Derivations created for this caller, torn down when it goes away. */
    disposers: (() => void)[]
}

let plain: Scope | null = null
let source: (() => Scope | null) | null = null

export function newScope(): Scope {
    return { stores: new Map(), disposers: [] }
}

// The hot path, and the reason the source is a pointer: on a client neither variable is ever written,
// so this is two loads and a branch that always goes the same way.
export function currentScope(): Scope | null {
    return source === null ? plain : source()
}

/**
 * Installed once by `abide/server`. The server's source falls back to the plain variable, so the
 * synchronous spelling keeps working on a server too — a test does not have to know which one is in
 * force.
 */
export function useScopeSource(fn: () => Scope | null): void {
    source = fn
}

export function plainScope(): Scope | null {
    return plain
}

/**
 * Storage `owner` keeps for the current caller, or `fallback` when there is no caller scope at all —
 * a client, a script, a test, where there is one caller forever and the module-level store IS right.
 *
 * `make` is a hoisted function rather than a closure built per call: the no-scope answer is the hot
 * one on a client, and it should cost a null check and nothing else.
 */
export function storeFor<T>(owner: object, make: () => T, fallback: T): T {
    const scope = currentScope()
    if (scope === null) return fallback
    const held = scope.stores.get(owner)
    if (held !== undefined) return held as T
    const made = make()
    scope.stores.set(owner, made)
    return made
}

/**
 * The same store, for an owner whose fallback COSTS something to build.
 *
 * Two functions rather than one taking `T | (() => T)`, because the difference is real and is paid
 * per call: every caller of `storeFor` above already holds its fallback — a map, a cell, a router —
 * and a `typeof` on that hot path would be a check for a case none of them have.
 *
 * A cell is the case that needs this. Constructing one RUNS its initial, so an eager fallback starts
 * a promise or a stream at module load — on a server, once for the process, before any request
 * exists — which is the exact thing scoping it was for. Constructing a memo runs nothing, which is
 * why `scopedArgless` can build its own eagerly and this cannot.
 */
export function storeForLazy<T>(owner: object, make: () => T, fallback: () => T): T {
    const scope = currentScope()
    if (scope === null) return fallback()
    const held = scope.stores.get(owner)
    if (held !== undefined) return held as T
    const made = make()
    scope.stores.set(owner, made)
    return made
}

/**
 * Run `fn` and settle `after` exactly once — whether it returned a value, threw, or handed back a
 * promise that later does either. The one shape both `isolate` and `serve` need to tear a scope down.
 *
 * Guarded rather than awaited: a synchronous body is the common case and an unconditional await
 * would cost it a promise wrap and a microtask tick.
 */
export function settling<T>(fn: () => T, after: () => void): T {
    let produced: T
    try {
        produced = fn()
    } catch (error) {
        after()
        throw error
    }
    if (!isThenable(produced)) {
        after()
        return produced
    }
    return (produced as PromiseLike<unknown>).then(
        (value: unknown) => {
            after()
            return value
        },
        (error: unknown) => {
            after()
            throw error
        },
    ) as T
}

export function disposeWith(dispose: () => void): void {
    const scope = currentScope()
    if (scope !== null) scope.disposers.push(dispose)
}

export function dropScope(scope: Scope): void {
    // Backwards: a derivation created later may read one created earlier.
    for (let i = scope.disposers.length - 1; i >= 0; i--) (scope.disposers[i] as () => void)()
    scope.disposers.length = 0
    scope.stores.clear()
}

// Async `isolate` bodies still in flight.
//
// The scope is held across an `await` so that a read after one is still this caller's. The cost of
// that is that a variable set at entry is no longer a reliable "am I inside a body" signal: a call
// made after the body suspended and a call lexically nested inside it look identical. Rather than
// guess between them — the wrong guess puts a read in another caller's cache, invisibly — ANY
// `isolate` while an async one is in flight is refused. `serve` is async-local and has no such rule.
let openAsync = 0

/**
 * Run `fn` with its own storage, then throw that storage away.
 *
 * One variable, set and put back, and held across an `await` so a read after one is still this
 * caller's. That is sound exactly while callers do not overlap, so starting another `isolate` while
 * an async one is in flight throws — including a nested one, because the two are indistinguishable
 * from here. A server uses `serve` from `abide/server`, which is async-local and allows both.
 */
export function isolate<T>(fn: () => T): T {
    if (openAsync > 0) {
        throw new Error(
            'abide: an async `isolate` is still in flight — one variable cannot tell two callers apart, so a second one is refused. Use `serve` from `abide/server`, which is async-local.',
        )
    }
    const scope = newScope()
    const previous = plain
    plain = scope
    let counted = false
    const result = settling(fn, () => {
        if (counted) openAsync--
        plain = previous
        dropScope(scope)
    })
    // `settling` hands back a thenable only when the body did, and in that case its teardown is a
    // microtask away — so arming the counter here is still inside the in-flight window.
    if (isThenable(result)) {
        counted = true
        openAsync++
    }
    return result
}
