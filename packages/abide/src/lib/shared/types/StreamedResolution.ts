import type { CacheSnapshotEntry } from './CacheSnapshotEntry.ts'

/*
Payload of one streamed `window.__abideResolve(...)` call. Three arms:

  - a full `CacheSnapshotEntry` (has `key` + body) settles a cache placeholder with warm data;
  - a `{ key, miss }` marker means the server couldn't snapshot that cache body (binary, rejected,
    evicted) so the client settles the placeholder with a live re-fetch instead;
  - a `{ cellKey, value }` (ADR-0035) carries a STREAMING CELL's server-resolved value, keyed by its
    render-path warm-key and `encodeRefJson`-encoded, applied post-hydration as a reactive update so
    a non-cache peek stops flashing `loading…` on hydrate.
  - a `{ cellSeed, value }` (ADR-0039) carries a STREAMED CHILD's blocking async-cell value that
    resolved AFTER the head `__SSR__.cells` snapshot (its render was deferred to the drain), seeded
    PRE-mount into `CELL_SEED` — the same warm partition as `__SSR__.cells` — so the child's cell
    constructs resolved on hydrate rather than re-running.

Discriminate on `cellSeed` then `cellKey` (cell) then `miss` (cache miss) then default (cache entry).
*/

/* The cache arms — a warm snapshot entry or a `{ key, miss }` marker. `streamCacheResolutions`
   yields exactly these (never the cell arm), so its element type is `CacheResolution`, keeping a
   `.key` access on its results well-typed. */
export type CacheResolution = CacheSnapshotEntry | { key: string; miss: true }

export type StreamedResolution =
    | CacheResolution
    | { cellKey: string; value: string }
    | { cellSeed: string; value: string }
