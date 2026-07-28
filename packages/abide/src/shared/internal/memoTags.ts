// Cache TAG registry + global tag selectors — rpc-core §8, shared-cache-plan §2.4 (PR4).
//
// A memo declaring `memo: { tags: [...] }` registers itself here under each tag. This is ISOMORPHIC:
// the registry depends on nothing above `shared/` (ADR 0026), and nothing in a tag verb is server
// machinery — `invalidate`/`refresh` drive the memo's own slot verbs, and the broadcast they trigger
// self-neuters on the client (a client memo has no `notify` sink). It was once gated on `crossRequest`,
// which made it server-only in effect: a browser memo is never `crossRequest` (`memo.ts`:
// `opts?.crossRequest === true && !isBrowser`), so `tags` were discarded in the browser and a client
// `refresh({ tags })` matched an empty registry and silently did nothing.
// The global verbs `invalidate({ tags })` / `refresh({ tags })` — the ONLY global cache-verb
// form (per-callable `fn.invalidate/refresh/publish` stay canonical) — select every registered memo
// carrying ANY listed tag and run its local drop/revalidate, which (through the memo's already-bound
// transport-free `notify` sink) broadcasts a per-slot frame on each `@rpc:` channel. A per-tag frame
// is also emitted on the reserved `@tag:<tag>` channel, which the BROWSER now joins (`clientProxy`
// → `mux.subscribeTagChannel`, authorized by declaration in `channelAuth.authorizeTagJoin`) and
// mirrors through `applyTagFrame`. That is what carries a server-side verb to a read that is not
// `crossRequest`: only a crossRequest route has an `@rpc:` channel, but any tagged one has this.
//
// The registry maps tag → the MEMOS carrying it, NOT individual slots: each entry enumerates the
// memo's CURRENT live slots on demand when a verb fires, so the registry never retains per-slot
// references and never grows
// with request/slot churn — it is bounded by the count of distinct tagged memos. Slot memory is
// managed independently by the shared store's LRU.

import { publishMemoFrame, tagChannelName } from './memoChannels.ts'

// One registered shared memo's tag-facing operations. `invalidate`/`refresh` drop/revalidate ALL of
// the memo's current slots and broadcast per-slot on the memo's `@rpc:` channels; `pending`/
// `refreshing` are LOCAL reactive aggregates over the memo's current slot states (no broadcast).
export interface TaggedMemo {
    tags: string[]
    invalidate(): void
    refresh(): void
    pending(): boolean
    refreshing(): boolean
}

// tag → the memos carrying it. A memo with N tags appears in N buckets.
const registry = new Map<string, Set<TaggedMemo>>()

// Register a memo under each of its tags, returning its unregister.
//
// The unregister is what lets tags come off `crossRequest`. A `crossRequest` memo is a module singleton
// that lives for the process, so registering one forever cost nothing — but a tagged `memo(...)` in a
// component `<script>` is built per instance, and each one holds `selectSlots`/`dropSlot` closures over
// its whole slot map. Without this, mounting that component N times would pin N entries in a
// process-global `Map` that nothing ever drains. `memo.ts` calls it from the same `onScopeDispose` that
// tears down a request-scoped auto backing.
export function registerTaggedMemo(entry: TaggedMemo): () => void {
    for (const tag of entry.tags) {
        let bucket = registry.get(tag)
        if (bucket === undefined) {
            bucket = new Set<TaggedMemo>()
            registry.set(tag, bucket)
        }
        bucket.add(entry)
    }
    return () => {
        for (const tag of entry.tags) {
            const bucket = registry.get(tag)
            if (bucket === undefined) continue
            bucket.delete(entry)
            // Drop the empty bucket too, so a churning per-instance memo leaves no tag keys behind.
            if (bucket.size === 0) registry.delete(tag)
        }
    }
}

// Every memo carrying ANY of the listed tags (partial match — a memo tagged both "a" and "b" is
// selected by `["a"]`). De-duplicated so a multi-tag memo is touched at most once per verb.
function selectMemos(tags: string[]): Set<TaggedMemo> {
    const result = new Set<TaggedMemo>()
    for (const tag of tags) {
        const bucket = registry.get(tag)
        if (bucket === undefined) continue
        for (const memo of bucket) result.add(memo)
    }
    return result
}

// Global `invalidate({ tags })`: drop every tagged memo's slots (lazy reload on next read) and
// broadcast an `invalidate` frame on each affected `@rpc:` channel, plus one on each `@tag:` channel.
export function invalidateTags(tags: string[]): void {
    for (const memo of selectMemos(tags)) memo.invalidate()
    for (const tag of tags) publishMemoFrame(tagChannelName(tag), { verb: 'invalidate' })
}

// Global `refresh({ tags })`: eagerly revalidate every tagged memo's slots (stale value retained
// while refreshing) and broadcast a `refresh` frame per `@rpc:` channel, plus one per `@tag:` channel.
export function refreshTags(tags: string[]): void {
    for (const memo of selectMemos(tags)) memo.refresh()
    for (const tag of tags) publishMemoFrame(tagChannelName(tag), { verb: 'refresh' })
}

// Apply an INBOUND tag frame — the browser mirroring a server-side `invalidate/refresh({ tags })`
// that arrived over the `@tag:` mux channel. Deliberately NOT `invalidateTags`/`refreshTags`: those
// re-publish onto the tag channel, and a received frame must not echo. (The echo would be inert today,
// since a browser publish lands in a local in-memory hub with no subscribers, but "inert because
// nothing happens to be listening" is not a property worth depending on.)
export function applyTagFrame(tag: string, verb: 'invalidate' | 'refresh'): void {
    for (const memo of selectMemos([tag])) {
        if (verb === 'invalidate') memo.invalidate()
        else memo.refresh()
    }
}

// Global `pending({ tags })`: LOCAL reactive aggregate — true if ANY tagged slot is on its first
// load. Reads every selected memo's slot states (no short-circuit) so a tracking caller subscribes
// to all of them. No broadcast.
export function pendingTags(tags: string[]): boolean {
    let any = false
    for (const memo of selectMemos(tags)) {
        if (memo.pending()) any = true
    }
    return any
}

// Global `refreshing({ tags })`: LOCAL reactive aggregate — true if ANY tagged slot is revalidating
// over a retained value. Same all-slots read discipline as `pendingTags`. No broadcast.
export function refreshingTags(tags: string[]): boolean {
    let any = false
    for (const memo of selectMemos(tags)) {
        if (memo.refreshing()) any = true
    }
    return any
}

// TEST-ONLY: drop all registrations. The registry is process-global; tests that create tagged memos
// call this in `afterEach` to stay isolated (mirrors `sharedStore().clear()`).
export function clearTagRegistry(): void {
    registry.clear()
}

// TEST-ONLY: how many memos are registered under `tag`. The registry is the only place the
// unregister is observable — a disposed memo's SLOTS die with its scope either way, so a test that
// watches for re-runs after disposal passes whether or not the entry was ever removed. This asserts
// the thing that actually leaks.
export function taggedMemoCount(tag: string): number {
    return registry.get(tag)?.size ?? 0
}
