// The `client` ladder. The second rung's claim is a COUNT, priced on `/bench`.
import type { Example } from 'abide-kit'
import One from './1-a-list.abide'
import ONE from './1-a-list.abide?source'
import Two from './2-key-it-so-a-move-is-a-move.abide'
import TWO from './2-key-it-so-a-move-is-a-move.abide?source'

export const LADDER: Example[] = [
    { adds: 'mount a list', source: ONE, view: One },
    { adds: 'key it, so a reorder MOVES rows instead of rewriting them', source: TWO, view: Two },
]
