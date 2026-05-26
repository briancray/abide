import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import { canonicalJson } from './canonicalJson.ts'

/*
Derives a cache key from a verb-defined remote function and its args. The
prefix is `${method} ${url}` where `url` is the route template. GET/DELETE
serialise args onto the URL as `?key=value` with keys sorted so the order
the caller assembled the object doesn't change the key; POST/PUT/PATCH join
args after a space as canonical JSON. Sorted key/value pairs are walked once
and concatenated directly so the hot GET-cache path doesn't allocate per
intermediate (entries / filtered / URLSearchParams).
*/
export function keyForRemoteCall(method: HttpVerb, url: string, args: unknown): string {
    const prefix = `${method} ${url}`
    if (method === 'GET' || method === 'DELETE') {
        if (args && typeof args === 'object' && !Array.isArray(args)) {
            const record = args as Record<string, unknown>
            const keys = Object.keys(record).sort()
            let search = ''
            for (const key of keys) {
                const value = record[key]
                if (value === undefined) {
                    continue
                }
                search += search ? '&' : ''
                search += `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
            }
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
