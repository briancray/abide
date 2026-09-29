/**
 * When each entry of a `Keyed` declaring `ttl` last produced, and how long it lives, by entry cell.
 *
 * 11.46. A leaf because `Keyed.ts` writes it and `Reactive.ts` reads it (`deadlineOf`), and the
 * second cannot import the first.
 */
export const ENTRY_LIVES = new WeakMap<object, { at: number; ms: number }>()
