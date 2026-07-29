// Accessor for the Bun server handling the current request. Throws outside a request scope,
// or when the scope carries no server (e.g. bare in-process test calls).

import { scopeField } from './internal/scopeField.ts'

export function server(): Bun.Server<undefined> {
    // The only accessor with a SECOND failure: a scope can exist and carry no server, which a bare
    // in-process call (`createTestApp`'s `rpc` proxy, an `abide run` script) legitimately produces.
    // That is a different message because it is a different situation — the caller IS in a request.
    const bound = scopeField('server', 'server')
    if (bound === undefined) {
        throw new Error('server(): no Bun server bound to the current request scope.')
    }
    return bound
}
