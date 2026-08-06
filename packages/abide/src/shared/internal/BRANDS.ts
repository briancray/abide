// The registry symbols both substrates recognise, in one place.
//
// A brand exists because the two renderers must identify a value WITHOUT importing what made it: the
// server has no reactivity in it at all, so it cannot ask the graph whether something is a source.
// `Symbol.for` is what lets the answer cross that seam.
//
// This file exists because the alternative failed. `abide.source` used to be declared separately in
// `graph.ts` and in `slots.ts` — a two-file contract with nothing checking the halves agreed — and
// `channel.ts` never joined it at all, which is how a channel came to render its own source text on
// the client while rendering its message on the server.

/**
 * Marks a **source**: `state`, `memo` or `channel`. Calling it is a reactive READ, so a slot reads it
 * rather than rendering it — that is the one question both substrates ask, and the whole reason the
 * mark exists.
 *
 * Narrower than `Cell`: every cell is a source, but a channel is a source that is not a cell (no
 * `set`, no `refresh`, not awaitable). The slot recogniser wants the wider question.
 */
export const SOURCE = Symbol.for('abide.source')

/**
 * Stamp a callable as a source. Every maker calls this FIRST, before any other member is assigned,
 * so all three source shapes gain the brand at the same point and stay monomorphic.
 *
 * A helper rather than the cast written out per maker: the cast is what a fourth source type would
 * silently forget, and forgetting it is not a type error — it is the client rendering the function's
 * own text where the server rendered its value.
 */
export function markSource<T>(callable: T): T {
    ;(callable as unknown as Record<symbol, true>)[SOURCE] = true
    return callable
}
