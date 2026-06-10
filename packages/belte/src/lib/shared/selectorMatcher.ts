import { producerKey } from './producerKey.ts'
import { toScopeSet } from './toScopeSet.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheSelector } from './types/CacheSelector.ts'

/*
Compiles a selector into an entry predicate shared by cache.invalidate(),
pending(), and refreshing() so all three interpret the call shapes identically:
  undefined            → every entry
  remote fn            → that function's calls (method+url prefix). `arg.url` is
                         the route template; per-call args appear as `?...`
                         (GET/DELETE) or after a space (canonical-json body) —
                         see keyForRemoteCall. `fn` and `fn.raw` match the same
                         set since they share method+url.
  producer fn          → that producer's calls (reference id prefix). Matches
                         only if the producer was cached at least once (else it
                         has no id and nothing matches).
  { scope }            → any entry sharing one of the requested scope tags. An
                         empty selector matches nothing.
*/
export function selectorMatcher<Args, Return>(
    arg?: CacheSelector<Args, Return>,
): (entry: CacheEntry) => boolean {
    if (arg === undefined) {
        return () => true
    }
    if (typeof arg === 'function') {
        /* Remote fns carry url/method; a producer keys on its reference id. */
        const prefix = 'url' in arg ? `${arg.method} ${arg.url}` : producerKey.existing(arg)
        if (prefix === undefined) {
            return () => false
        }
        return (entry) =>
            entry.key === prefix ||
            entry.key.startsWith(`${prefix}?`) ||
            entry.key.startsWith(`${prefix} `)
    }
    if (arg.scope === undefined) {
        return () => false
    }
    const requestedScopes = toScopeSet(arg.scope)
    return (entry) => entry.scope !== undefined && intersects(entry.scope, requestedScopes)
}

/* True when an entry's tags and the requested tags overlap on any tag. */
function intersects(entryScopes: Set<string>, requestedScopes: Set<string>): boolean {
    return requestedScopes.values().some((scope) => entryScopes.has(scope))
}
