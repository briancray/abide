/* The await-resume manifest: the resolved value (or error) of each streamed
   `await` block, keyed by its boundary id. The SSR stream serializes each value
   alongside its fragment; the client registers it (via `applyResolved` or the
   inline swap script), and hydration reads it so an `await` block adopts the
   resolved branch with the real value instead of re-running the promise.

   Backed by `globalThis.__abideResume` so the inline stream-swap script (vanilla,
   running during the stream before the bundle loads) and the framework share one
   store: whoever runs first creates it, the other adopts the same reference. */
export type ResumeEntry = { ok: true; value: unknown } | { ok: false; error: unknown }

const globalScope = globalThis as { __abideResume?: Record<number, ResumeEntry> }
globalScope.__abideResume ??= {}

// @readme plumbing
export const RESUME: Record<number, ResumeEntry> = globalScope.__abideResume
