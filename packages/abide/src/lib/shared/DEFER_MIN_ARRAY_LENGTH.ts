/*
The array-length above which a blocking `{#await cache()}` value is worth deferring (shipped
inert, materialized on idle) rather than inlined and hydrated eagerly at boot. Deferral trades
a live boot for a cheaper one; below this many rows the boot decode is cheap enough that the
trade doesn't pay, so the block stays eager — fully interactive from the first frame, no wake
needed. Only genuinely large grids cross it and take the inert-then-idle-wake path.

An O(1) `.length` heuristic (measured on the resolved value, before serialization): array-shaped
cache reads — lists, grids, tables — are the payloads big enough to matter, and the ones the
inert path was built for. Non-array values never defer. A deliberately generous default: with
idle-wake, a deferred block is interactive anyway (live before a human acts), so this is a
boot-performance knob, not a correctness one — set high so eager-and-simple is the common case.
*/
export const DEFER_MIN_ARRAY_LENGTH = 500
