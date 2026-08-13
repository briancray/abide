// The two verbs, and the third rung is what only one of them can do.
import type { Example } from 'abide-kit'
import One from './1-invalidate-this-is-wrong.abide'
import ONE from './1-invalidate-this-is-wrong.abide?source'
import Two from './2-refresh-this-may-be-stale.abide'
import TWO from './2-refresh-this-may-be-stale.abide?source'
import Three from './3-reach-it-by-tag.abide'
import THREE from './3-reach-it-by-tag.abide?source'

export const LADDER: Example[] = [
    { adds: '`invalidate` — this data is WRONG, so drop it and start nothing', source: ONE, view: One },
    { adds: '`refresh` — it may be STALE, so keep serving it and re-run', source: TWO, view: Two },
    { adds: 'tags, so the verb reaches the DATA without naming a memo', source: THREE, view: Three },
]
