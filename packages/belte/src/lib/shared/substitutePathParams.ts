import type { HttpVerb } from '../types/HttpVerb.ts'

/*
Substitutes `:name` segments out of a route template using matching keys from
`args`, returning the rewritten URL plus the remaining args (or undefined when
nothing's left). Throws when a placeholder has no corresponding key — a caller
bug worth surfacing loudly since the request would otherwise hit a literal
`:name` segment. Used by both the server-side defineVerb and the client-side
remoteProxy so the constructed URL is identical on both sides.
*/
export function substitutePathParams<Args>(
    method: HttpVerb,
    url: string,
    args: Args | undefined,
): { url: string; leftover: Record<string, unknown> | undefined } {
    const argsObject =
        args && typeof args === 'object' && !Array.isArray(args)
            ? { ...(args as Record<string, unknown>) }
            : undefined
    const substituted = url.replace(/:(\w+)/g, (_, name: string) => {
        if (!argsObject || argsObject[name] === undefined) {
            throw new Error(`[belte] missing path param '${name}' for ${method} ${url}`)
        }
        const value = argsObject[name]
        delete argsObject[name]
        return encodeURIComponent(String(value))
    })
    const leftover = argsObject && Object.keys(argsObject).length > 0 ? argsObject : undefined
    return { url: substituted, leftover }
}
