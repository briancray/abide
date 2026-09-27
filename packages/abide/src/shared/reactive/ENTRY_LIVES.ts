// 11.46 — WHEN EACH ENTRY OF A `Keyed` DECLARING `ttl` LAST PRODUCED, and how long it lives, by the
// entry's cell. A leaf because `Keyed.ts` writes it and `Reactive.ts` reads it (`deadlineOf`), and
// the second cannot import the first.
export const ENTRY_LIVES = new WeakMap<object, { at: number; ms: number }>()
