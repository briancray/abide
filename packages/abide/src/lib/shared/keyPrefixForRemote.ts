import type { HttpMethod } from './types/HttpMethod.ts'

/*
The cache/error-registry key prefix a remote function's entries share: `${method} ${url}`
(method + route template). The single definition of the prefix grammar — keyForRemoteCall
appends `?query`/` body` onto it, and keyMatchesPrefix extends it — so every consumer that
prefix-matches (`fn.error()`, the cache selector prefix, the MCP tool labels) composes the
SAME prefix and can't silently mismatch if the format ever changes.
*/
export function keyPrefixForRemote(method: HttpMethod, url: string): string {
    return `${method} ${url}`
}
