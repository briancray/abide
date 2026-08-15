// The `client` ladder. The second rung's claim is a COUNT, priced on `/bench`.
import type { Example } from 'harness'
import One from './1-a-list.abide'
import ONE from './1-a-list.abide?source'
import Two from './2-key-it-so-a-move-is-a-move.abide'
import TWO from './2-key-it-so-a-move-is-a-move.abide?source'

// `of` is EMPTY on both: what these rungs show is `mount` doing its work, and `mount` is reached
// only by `abide build`'s generated client entry — not a name an author types, so not a `/docs` page.
// The rungs still compile, still run under `bun test` and are still priced on `/bench`.
export const LADDER: Example[] = [
    { adds: 'mount a list', of: [], source: ONE, view: One },
    { adds: 'key it, so a reorder MOVES rows instead of rewriting them', of: [], source: TWO, view: Two },
]
