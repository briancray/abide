/*
The per-render fail-closed deadline (ADR-0024) for the SSR auto-streaming drain: how
long the response stream stays open waiting for triggered BARE reads to settle before
shipping the still-pending ones as `{ key, miss }` markers (→ client refetch on hydrate)
and closing. The shell has already flushed by the time the drain runs, so this bounds
time-to-complete, never TTFB. A single per-render knob (the ADR's leaning); the {#await}
drain hands the same machinery already-settled entries, so this never delays Tier-3.
*/
export const SSR_STREAM_DEADLINE_MS = 10_000
