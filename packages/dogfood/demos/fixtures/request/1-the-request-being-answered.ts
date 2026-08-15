import { GET, request } from 'abide/server'

/**
 * The `Request` this call is part of, as an AMBIENT rather than a parameter.
 *
 * So a helper four frames down reads a header without every frame between it and the route
 * declaring one — the same reason `route()` is an ambient, and the same reason a `memo` at module
 * scope is per-caller: the scope is what a request IS, so anything inside one can ask.
 */
export const catalogue = GET(() => ({ agent: request().headers.get('user-agent') ?? 'unknown' }))
