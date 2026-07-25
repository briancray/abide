// Cache TAG registry + global tag selectors — rpc-core §8, shared-cache-plan §2.4 (PR4).
//
// A SHARED memo declaring `memo: { tags: [...] }` registers itself here (server-only) under each
// tag. The global verbs `invalidate({ tags })` / `refresh({ tags })` — the ONLY global cache-verb
// form (per-callable `fn.invalidate/refresh/publish` stay canonical) — select every registered memo
// carrying ANY listed tag and run its local drop/revalidate, which (through the memo's already-bound
// transport-free `notify` sink) broadcasts a per-slot frame on each `@rpc:` channel. A per-tag frame
// is also emitted on the reserved `@tag:<tag>` channel so a tag-level subscriber mirrors it (client
// bare-tag subscription itself is deferred; the substrate is complete).
//
// The registry maps tag → the MEMOS carrying it, NOT individual slots: a tagged memo is a process
// lifetime singleton (one per tagged RPC), and each entry enumerates the memo's CURRENT live slots
// on demand when a verb fires. So the registry never retains per-slot references and never grows
// with request/slot churn — it is bounded by the count of distinct tagged memos. Slot memory is
// managed independently by the shared store's LRU.

import { publishMemoFrame, tagChannelName } from './memoChannels.ts'

// One registered shared memo's tag-facing operations. `invalidate`/`refresh` drop/revalidate ALL of
// the memo's current slots and broadcast per-slot on the memo's `@rpc:` channels; `pending`/
// `refreshing` are LOCAL reactive aggregates over the memo's current slot signals (no broadcast).
export interface TaggedMemo {
    tags: string[]
    invalidate(): void
    refresh(): void
    pending(): boolean
    refreshing(): boolean
}

// tag → the memos carrying it. A memo with N tags appears in N buckets.
const registry = new Map<string, Set<TaggedMemo>>()

// Register a shared memo under each of its tags. Returns an unregister function (called on the rare
// disposal of a dynamically-created tagged memo; module-singleton RPC memos simply stay registered).
export function registerTaggedMemo(entry: TaggedMemo): () => void {
    for (const tag of entry.tags) {
        let bucket = registry.get(tag)
        if (bucket === undefined) {
            bucket = new Set<TaggedMemo>()
            registry.set(tag, bucket)
        }
        bucket.add(entry)
    }
    return (): void => {
        for (const tag of entry.tags) {
            const bucket = registry.get(tag)
            if (bucket === undefined) continue
            bucket.delete(entry)
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

// Global `pending({ tags })`: LOCAL reactive aggregate — true if ANY tagged slot is on its first
// load. Reads every selected memo's slot signals (no short-circuit) so a tracking caller subscribes
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
