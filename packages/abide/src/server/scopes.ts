// The server's caller scope, and the ambients that ride on it.
//
// `AsyncLocalStorage` is the one place a node API is unavoidable: two requests interleave across
// every `await`, so the scope has to follow the continuation rather than a variable someone sets and
// puts back. `$shared/internal/scopes.ts` keeps the plain-variable form for a client, a test or a
// script and knows nothing about this file — installing the source from here is what keeps the
// browser bundle free of a shim it would never use.
//
// The ambients are plain reads, not cells. A server render is a snapshot: there is nothing to wake
// later, so a `request()` that could change would be answering a question nobody can re-ask.

import { AsyncLocalStorage } from 'node:async_hooks'
import {
    dropScope,
    newScope,
    plainScope,
    type Scope,
    settling,
    useScopeSource,
} from '$shared/internal/scopes.ts'
import { useHrefSource } from '$shared/router.ts'

interface Serving {
    scope: Scope
    request: Request
    /** Both built on first ask, like `cookies` — most requests open neither. */
    bag: Map<string, unknown> | null
    cookies: Map<string, string> | null
}

// Built on the first `serve`, never at import.
//
// `abide/server` has to stay loadable in a browser — the SSR demo page renders through it — and Bun
// bundles `node:async_hooks` for a browser target as an EMPTY OBJECT. It compiles; `new
// AsyncLocalStorage` then throws at runtime, so constructing one at module scope would take down
// every page that imports this entry point. Installing the scope source lazily too means a browser
// that never calls `serve` also keeps the fastest `currentScope()` — the one that reads a null.
let STORAGE: AsyncLocalStorage<Serving> | null = null

function storage(): AsyncLocalStorage<Serving> {
    if (STORAGE !== null) return STORAGE
    if (!canServe()) {
        throw new Error(
            'abide: serve() is server-only — there is no AsyncLocalStorage here. On a client there is one caller forever, so nothing needs scoping; `isolate` is the spelling that works in both places.',
        )
    }
    STORAGE = new AsyncLocalStorage<Serving>()
    // Falls back to the plain scope, so `isolate` still works on a server and a test does not have
    // to know which source is in force.
    useScopeSource(() => STORAGE?.getStore()?.scope ?? plainScope())
    // Where a request thinks it is. Installed rather than pushed at every `serve`, so a request that
    // never asks about its route pays nothing at all for routing existing.
    useHrefSource(() => STORAGE?.getStore()?.request.url ?? null)
    return STORAGE
}

function serving(verb: string): Serving {
    const held = STORAGE?.getStore()
    if (held === undefined) {
        throw new Error(
            `abide: ${verb}() was called outside a request — wrap the work in \`serve(request, …)\``,
        )
    }
    return held
}

/**
 * Serve one request: `fn` runs with its own memo cache and its own ambients, and both are dropped
 * when it settles. Every module-level `memo` without `{ global }` is per-caller because of this — so
 * a handler that forgets to think about it still cannot serve the previous caller's data.
 */
export function serve<T>(request: Request, fn: () => T): T {
    const held: Serving = { scope: newScope(), request, bag: null, cookies: null }
    return storage().run(held, () => settling(fn, () => dropScope(held.scope)))
}

/**
 * Serve one request where there may be no scoping to do.
 *
 * The branch lives HERE rather than at each entry point, so the next one does not have to remember
 * it: `serve` throws where there is no `AsyncLocalStorage`, which is the right answer for anyone who
 * called it directly and the wrong one for a browser dispatching to itself — there is one caller
 * forever there, so a memo's cache belongs to it by definition.
 */
export function serveIfScoped<T>(request: Request, fn: () => T): T {
    return canServe() ? serve(request, fn) : fn()
}

/** Whether there is a caller to ask about at all. */
export function isServing(): boolean {
    return STORAGE?.getStore() !== undefined
}

/**
 * Can requests be scoped here at all?
 *
 * False in exactly one place — a browser, where Bun bundles `node:async_hooks` as an empty object.
 * Asked rather than catching the throw, so `serve` keeps throwing for a direct caller.
 */
function canServe(): boolean {
    return typeof AsyncLocalStorage === 'function'
}

/** The request being served. Throws outside one — there is no honest answer to guess. */
export function request(): Request {
    return serving('request').request
}

/** A bag of values carried for the life of one request. Built on first ask. */
export function bag(): Map<string, unknown> {
    const held = serving('bag')
    if (held.bag !== null) return held.bag
    const made = new Map<string, unknown>()
    held.bag = made
    return made
}

/** The cookies of the request being served. Parsed once per request, on first ask. */
export function cookies(): Map<string, string> {
    const held = serving('cookies')
    if (held.cookies !== null) return held.cookies
    const parsed = new Map<string, string>()
    const header = held.request.headers.get('cookie')
    if (header !== null) {
        for (const pair of header.split(';')) {
            const at = pair.indexOf('=')
            if (at < 0) continue
            parsed.set(pair.slice(0, at).trim(), decodeURIComponent(pair.slice(at + 1).trim()))
        }
    }
    held.cookies = parsed
    return parsed
}
