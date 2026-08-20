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
 * Narrower than `State`: every state is a source, but a channel is a source that is not a state (no
 * `set`, no `refresh`, not awaitable). The slot recogniser wants the wider question.
 *
 * Not exported: the two functions below are the whole of what anyone needs of it, and a caller
 * holding the symbol is a caller who can brand or unbrand one without going through `markSource`.
 */
const SOURCE = Symbol.for('abide.source')

/**
 * Stamp a callable as a source. Every maker calls this FIRST, before any other member is assigned,
 * so all five — the state `makeState` builds, `memo`'s argless facade, `channel`, `remoteSocket` and a
 * socket `Connection` — gain the brand at the same point and stay monomorphic.
 *
 * A helper rather than the cast written out per maker: the cast is what a SIXTH source type would
 * silently forget, and forgetting it is not a type error — it is the client rendering the function's
 * own text where the server rendered its value.
 */
export function markSource<T>(callable: T): T {
    ;(callable as unknown as Record<symbol, true>)[SOURCE] = true
    return callable
}

/**
 * Whether this value is one — the reader of the mark, beside the writer of it.
 *
 * `source` is the right question rather than `state`: a state is a source you can also `set` and
 * `await`, a channel is a source that is neither, and what a slot or a prop needs to know is only
 * whether to READ it.
 */
export function isSource(value: unknown): value is () => unknown {
    return typeof value === 'function' && SOURCE in value
}
