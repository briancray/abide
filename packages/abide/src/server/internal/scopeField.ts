// Read one field off the active request scope, or throw naming the accessor that asked.
//
// The four ambient accessors — `request()`, `cookies()`, `context()`, `server()` — are one contract
// with four spellings: what is thrown, when, and in what words. Each stated it itself, so "no active
// request scope" existed four times and the SHAPE of the message was a coincidence rather than a rule.
// The message is load-bearing: these throw specifically so a `memo({ crossRequest: true })` body, which
// runs scope-exited on every path, fails closed instead of baking one caller's request into a slot
// every later caller is served. What an author sees when that happens should not depend on which of
// the four they reached for.
//
// The FILES stay one-per-accessor: `abide/server/request` is a published import path, and the export
// map (`./server/*` → `./src/server/*.ts`) makes each filename part of the public surface. It is the
// rule that moves here, not the modules.

import { currentScope, type RequestScope } from './requestScope.ts'

export function scopeField<K extends keyof RequestScope>(
    accessor: string,
    field: K,
): RequestScope[K] {
    const scope = currentScope()
    if (scope === undefined) {
        throw new Error(
            `${accessor}(): no active request scope — call it inside a request handler.`,
        )
    }
    return scope[field]
}
