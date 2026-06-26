import type { HttpMethod } from './types/HttpMethod.ts'

/*
Whether a rpc carries its args in the request body (POST/PUT/PATCH) vs
on the query string (GET/DELETE/HEAD). Single source for the split so the
synthesized Request (buildRpcRequest), the handler-side parse (parseArgs),
the cache key (keyForRemoteCall), and the OpenAPI doc can't disagree.
*/
const BODY_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'PATCH'])

export function carriesBodyArgs(method: HttpMethod): boolean {
    return BODY_METHODS.has(method)
}
