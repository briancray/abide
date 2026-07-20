// Cache TAG registry + global tag selectors — rpc-core §8, shared-cache-plan §2.4 (PR4).
//
// A SHARED cell declaring `cache: { tags: [...] }` registers itself here (server-only) under each
// tag. The global verbs `invalidate({ tags })` / `refresh({ tags })` — the ONLY global cache-verb
// form (per-callable `fn.invalidate/refresh/amend` stay canonical) — select every registered cell
// carrying ANY listed tag and run its local drop/revalidate, which (through the cell's already-bound
// transport-free `notify` sink) broadcasts a per-slot frame on each `@rpc:` channel. A per-tag frame
// is also emitted on the reserved `@tag:<tag>` channel so a tag-level subscriber mirrors it (client
// bare-tag subscription itself is deferred; the substrate is complete).
//
// The registry maps tag → the CELLS carrying it, NOT individual slots: a tagged cell is a process
// lifetime singleton (one per tagged RPC), and each entry enumerates the cell's CURRENT live slots
// on demand when a verb fires. So the registry never retains per-slot references and never grows
// with request/slot churn — it is bounded by the count of distinct tagged cells. Slot memory is
// managed independently by the shared store's LRU.

import { publishCacheFrame, tagChannelName } from "./cacheChannels.ts";

// One registered shared cell's tag-facing operations. `invalidate`/`refresh` drop/revalidate ALL of
// the cell's current slots and broadcast per-slot on the cell's `@rpc:` channels; `pending`/
// `refreshing` are LOCAL reactive aggregates over the cell's current slot signals (no broadcast).
export interface TaggedCell {
  tags: string[];
  invalidate(): void;
  refresh(): void;
  pending(): boolean;
  refreshing(): boolean;
}

// tag → the cells carrying it. A cell with N tags appears in N buckets.
const registry = new Map<string, Set<TaggedCell>>();

// Register a shared cell under each of its tags. Returns an unregister function (called on the rare
// disposal of a dynamically-created tagged cell; module-singleton RPC cells simply stay registered).
export function registerTaggedCell(entry: TaggedCell): () => void {
  for (const tag of entry.tags) {
    let bucket = registry.get(tag);
    if (bucket === undefined) {
      bucket = new Set<TaggedCell>();
      registry.set(tag, bucket);
    }
    bucket.add(entry);
  }
  return (): void => {
    for (const tag of entry.tags) {
      const bucket = registry.get(tag);
      if (bucket === undefined) continue;
      bucket.delete(entry);
      if (bucket.size === 0) registry.delete(tag);
    }
  };
}

// Every cell carrying ANY of the listed tags (partial match — a cell tagged both "a" and "b" is
// selected by `["a"]`). De-duplicated so a multi-tag cell is touched at most once per verb.
function selectCells(tags: string[]): Set<TaggedCell> {
  const result = new Set<TaggedCell>();
  for (const tag of tags) {
    const bucket = registry.get(tag);
    if (bucket === undefined) continue;
    for (const cell of bucket) result.add(cell);
  }
  return result;
}

// Global `invalidate({ tags })`: drop every tagged cell's slots (lazy reload on next read) and
// broadcast an `invalidate` frame on each affected `@rpc:` channel, plus one on each `@tag:` channel.
export function invalidateTags(tags: string[]): void {
  for (const cell of selectCells(tags)) cell.invalidate();
  for (const tag of tags) publishCacheFrame(tagChannelName(tag), { verb: "invalidate" });
}

// Global `refresh({ tags })`: eagerly revalidate every tagged cell's slots (stale value retained
// while refreshing) and broadcast a `refresh` frame per `@rpc:` channel, plus one per `@tag:` channel.
export function refreshTags(tags: string[]): void {
  for (const cell of selectCells(tags)) cell.refresh();
  for (const tag of tags) publishCacheFrame(tagChannelName(tag), { verb: "refresh" });
}

// Global `pending({ tags })`: LOCAL reactive aggregate — true if ANY tagged slot is on its first
// load. Reads every selected cell's slot signals (no short-circuit) so a tracking caller subscribes
// to all of them. No broadcast.
export function pendingTags(tags: string[]): boolean {
  let any = false;
  for (const cell of selectCells(tags)) {
    if (cell.pending()) any = true;
  }
  return any;
}

// Global `refreshing({ tags })`: LOCAL reactive aggregate — true if ANY tagged slot is revalidating
// over a retained value. Same all-slots read discipline as `pendingTags`. No broadcast.
export function refreshingTags(tags: string[]): boolean {
  let any = false;
  for (const cell of selectCells(tags)) {
    if (cell.refreshing()) any = true;
  }
  return any;
}

// TEST-ONLY: drop all registrations. The registry is process-global; tests that create tagged cells
// call this in `afterEach` to stay isolated (mirrors `sharedStore().clear()`).
export function clearTagRegistry(): void {
  registry.clear();
}
