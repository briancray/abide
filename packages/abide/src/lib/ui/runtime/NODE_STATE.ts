/*
The three settle-states a reactive node moves through, for value-memoised
(push-pull) propagation. CLEAN: the value is current. CHECK: a *transitive*
dependency may have changed — the value can't be trusted until the direct deps are
refreshed. DIRTY: a *direct* dependency changed — recompute.

A signal write marks its direct subscribers DIRTY and the rest of their cone
CHECK; a read then settles a node by refreshing only the deps that the check walk
finds actually changed. A computed that recomputes to an `Object.is`-equal value
leaves its subscribers untouched, so an unchanged value never wakes downstream —
the memoisation a single bare boolean `dirty` flag (no CHECK tier, no value
compare) couldn't express.
*/
/* Typed as `number` (not `as const` literals) so a `node.status === CHECK` guard
   doesn't narrow the field to the literal `1` — the recursive `updateIfNecessary`
   call mutates `status` out of band, which TS can't see, and a literal narrowing
   would make the following `=== DIRTY` check a "no overlap" error. */
export const NODE_STATE: {
    readonly CLEAN: number
    readonly CHECK: number
    readonly DIRTY: number
} = { CLEAN: 0, CHECK: 1, DIRTY: 2 }
