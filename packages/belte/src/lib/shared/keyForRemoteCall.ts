import type { HttpVerb } from '../types/HttpVerb.ts'
import { canonicalJson } from './canonicalJson.ts'

/*
Derives a cache key from a verb-defined remote function and its args. The
prefix is `${method} ${url}` where `url` is the route template. GET/DELETE
serialise args onto the URL as `?key=value` with keys sorted so the order
the caller assembled the object doesn't change the key; POST/PUT/PATCH join
args after a space as canonical JSON.
*/
export function keyForRemoteCall(method: HttpVerb, url: string, args: unknown): string {
    const prefix = `${method} ${url}`
    if (method === 'GET' || method === 'DELETE') {
        if (args && typeof args === 'object' && !Array.isArray(args)) {
            const sorted = Object.entries(args as Record<string, unknown>)
                .filter(([, value]) => value !== undefined)
                .toSorted(([a], [b]) => a.localeCompare(b))
            const search = new URLSearchParams(sorted as Array<[string, string]>).toString()
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
