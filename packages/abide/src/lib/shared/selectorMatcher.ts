import { keyMatchesPrefix } from './keyMatchesPrefix.ts'
import { selectorPrefix } from './selectorPrefix.ts'
import { setsIntersect } from './setsIntersect.ts'
import { toTagSet } from './toTagSet.ts'
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
  { tags }             → any entry sharing one of the requested tags. An
                         empty selector matches nothing.
  fn + args            → exactly that call's entry (the key derived from the
                         same encoders the read path uses); other args
                         variants of the fn are untouched.
Fn-selector identity (prefix resolution + the cache()-wrapper throw) lives in
selectorPrefix, the prefix grammar in keyMatchesPrefix — both shared with the
probes' scoped lifecycle channels so a probe subscribes to exactly the entries
this predicate would match. A caller that already resolved the prefix (the
invalidate/probe paths derive it for their own use) passes it as
`precomputedPrefix` so the args encoding isn't re-derived per call.
*/
export function selectorMatcher<Args, Return>(
    arg?: CacheSelector<Args, Return>,
    args?: Args,
    precomputedPrefix?: string,
): (entry: CacheEntry) => boolean {
    if (arg === undefined) {
        return () => true
    }
    if (typeof arg === 'function') {
        const prefix = precomputedPrefix ?? selectorPrefix(arg, args)
        if (prefix === undefined) {
            return () => false
        }
        if (args !== undefined) {
            return (entry) => entry.key === prefix
        }
        return (entry) => keyMatchesPrefix(entry.key, prefix)
    }
    if (arg.tags === undefined) {
        return () => false
    }
    const requestedTags = toTagSet(arg.tags)
    return (entry) => entry.tags !== undefined && setsIntersect(requestedTags, entry.tags)
}
