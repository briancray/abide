/* The await-resume manifest: the resolved value (or error) of each streamed
   `await` block, keyed by its boundary id. The SSR stream serializes each entry
   alongside its fragment; the client registers it (via `applyResolved` or the
   inline swap script), and hydration reads it so an `await` block adopts the
   resolved branch with the real value instead of re-running the promise.

   Each value is the ref-json-encoded ResumeEntry STRING, not the decoded object:
   the entry is encoded with the ref-json codec (so a resolved value carrying cycles
   or shared back-references survives, where JSON would drop it) and decoded lazily
   at the read site in `awaitBlock`. Storing the raw string keeps the inline
   stream-swap script — vanilla, running before the bundle and the codec load — able
   to register an entry without the decoder.

   Backed by `globalThis.__abideResume` so the inline stream-swap script and the
   framework share one store: whoever runs first creates it, the other adopts the
   same reference. */
export type ResumeEntry = { ok: true; value: unknown } | { ok: false; error: unknown }

/* Deferred-resume marker (Tier 2): a large cache-backed `{#await cache()}` ships this in
   place of its value — just the cache key, so hydration adopts the server branch inert and
   pays no value decode. The client seeds that key lazily and materializes it only on a later
   re-read. Discriminated from a ResumeEntry by the `defer` field. */
export type DeferMarker = { defer: true; key: string }

const globalScope = globalThis as { __abideResume?: Record<number, string> }
globalScope.__abideResume ??= {}

// @documentation plumbing
export const RESUME: Record<number, string> = globalScope.__abideResume
