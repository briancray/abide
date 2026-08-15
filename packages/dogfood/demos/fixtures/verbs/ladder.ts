// The two verbs, and the third rung is what only one of them can do.
import type { Example } from 'harness'
import One from './1-invalidate-this-is-wrong.abide'
import ONE from './1-invalidate-this-is-wrong.abide?source'
import Two from './2-refresh-this-may-be-stale.abide'
import TWO from './2-refresh-this-may-be-stale.abide?source'
import Three from './3-reach-it-by-tag.abide'
import THREE from './3-reach-it-by-tag.abide?source'

export const LADDER: Example[] = [
    { adds: '`invalidate` — this data is WRONG, so drop it and start nothing', of: ['invalidate'], source: ONE, view: One },
    { adds: '`refresh` — it may be STALE, so keep serving it and re-run', of: ['refresh'], source: TWO, view: Two },
    // A tag is an address BOTH verbs take, so this rung belongs on both pages rather than on whichever
    // one the file happened to import.
    { adds: 'tags, so the verb reaches the DATA without naming a memo', of: ['invalidate', 'refresh'], source: THREE, view: Three },
]
