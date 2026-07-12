import { keyMatchesPrefix } from './keyMatchesPrefix.ts'
import { setsIntersect } from './setsIntersect.ts'
import { toTagSet } from './toTagSet.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheStalenessFrame } from './types/CacheStalenessFrame.ts'

/*
Rebuilds the entry predicate from a decoded staleness envelope (ADR-0041) — the
decode half of serializeSelector, driving the SAME store loop a local apply does
(cache.invalidateMatching / cache.refreshMatching). The three modes are
selectorMatcher's three real branches with the `args !== undefined` discriminant
replaced by the explicit `mode`, reusing keyMatchesPrefix/toTagSet so a decoded
predicate can't disagree with what a local selector would have matched:

  key    → exactly that call's entry (args already the canonical string the read
           path keyed with, so it re-matches by equality — no ref-json codec crosses)
  prefix → every args-variant of that fn (method+url prefix)
  tags   → any entry sharing one of the requested tags
*/
export function matcherFromEnvelope(frame: CacheStalenessFrame): (entry: CacheEntry) => boolean {
    if (frame.mode === 'key') {
        const key = frame.match
        return (entry) => entry.key === key
    }
    if (frame.mode === 'prefix') {
        const prefix = frame.match
        return (entry) => keyMatchesPrefix(entry.key, prefix)
    }
    const requestedTags = toTagSet(frame.tags)
    return (entry) => entry.tags !== undefined && setsIntersect(requestedTags, entry.tags)
}
