/**
 * 15.19 — the refusals below 500 that say "not now" rather than "no": a request that took too long,
 * one sent too early, and one of too many. Interpolated into the worker the server writes as text.
 */
export const TRANSIENT_STATUSES: readonly number[] = [408, 425, 429]
