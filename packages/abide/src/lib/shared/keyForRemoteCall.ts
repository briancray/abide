import { canonicalJson } from './canonicalJson.ts'
import { carriesBodyArgs } from './carriesBodyArgs.ts'
import { keyPrefixForRemote } from './keyPrefixForRemote.ts'
import { queryStringFromArgs } from './queryStringFromArgs.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

/*
Derives a cache key from a rpc-defined remote function and its args. The
prefix is `${method} ${url}` where `url` is the route template. GET/DELETE/HEAD
serialise args onto the URL as `?key=value` (sorted, via queryStringFromArgs —
the same encoder buildRpcRequest builds its query with, so the key and the
synthesized Request can't disagree); POST/PUT/PATCH join args after a space as
canonical JSON. The rpc split mirrors buildRpcRequest exactly.
*/
export function keyForRemoteCall(method: HttpMethod, url: string, args: unknown): string {
    const prefix = keyPrefixForRemote(method, url)
    if (!carriesBodyArgs(method)) {
        if (args && typeof args === 'object' && !Array.isArray(args)) {
            const search = queryStringFromArgs(args as Record<string, unknown>, true)
            if (search.length > 0) {
                return `${prefix}?${search}`
            }
        }
        return prefix
    }
    if (args === undefined) {
        return prefix
    }
    return `${prefix} ${canonicalJson(args)}`
}
