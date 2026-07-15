import { SEEDS } from '../../shared/SEEDS.ts'

/* The await-resume manifest: the resolved value (or error) of each streamed
   `await` block, keyed by its boundary id. The SSR stream serializes each entry
   alongside its fragment; the client registers it (via the inline swap script),
   and hydration reads it so an `await` block adopts the
   resolved branch with the real value instead of re-running the promise.

   Each value is the ref-json-encoded ResumeEntry STRING, not the decoded object:
   the entry is encoded with the ref-json codec (so a resolved value carrying cycles
   or shared back-references survives, where JSON would drop it) and decoded lazily
   at the read site in `awaitBlock`. Storing the raw string keeps the inline
   stream-swap script — vanilla, running before the bundle and the codec load — able
   to register an entry without the decoder.

   The `resume` partition of the one `__abideSeeds` manifest (ADR-0048, see SEEDS) —
   the inline scripts and the framework share the same reference. */
export type ResumeEntry = { ok: true; value: unknown } | { ok: false; error: unknown }

// @documentation plumbing
export const RESUME: Record<string, string> = SEEDS.resume
