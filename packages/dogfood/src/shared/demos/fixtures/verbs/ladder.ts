// The two verbs, one strand each. A rung claims ONE of them, because `/docs/invalidate` and
// `/docs/refresh` are separate pages and a rung showing both puts the wrong verb under a name.
import type { Example } from 'harness'
import One from './1-invalidate-this-is-wrong.abide'
import ONE from './1-invalidate-this-is-wrong.abide?source'
import Two from './2-refresh-this-may-be-stale.abide'
import TWO from './2-refresh-this-may-be-stale.abide?source'
import Three from './3-invalidate-by-tag.abide'
import THREE from './3-invalidate-by-tag.abide?source'
import Four from './4-refresh-by-tag.abide'
import FOUR from './4-refresh-by-tag.abide?source'
import Five from './5-refresh-everything.abide'
import FIVE from './5-refresh-everything.abide?source'

// Interleaved rather than grouped, so the two strands stay adjacent in the file — and each page
// filters to its own, which is why rung 3 reads as rung 1 plus tags and rung 4 as rung 2 plus tags.
export const LADDER: Example[] = [
    {
        adds: '`invalidate` — this data is WRONG, so drop it and start nothing',
        of: ['invalidate'],
        source: ONE,
        view: One,
    },
    {
        adds: '`refresh` — it may be STALE, so keep serving it and re-run',
        of: ['refresh'],
        source: TWO,
        view: Two,
    },
    {
        adds: 'tags, so `invalidate` reaches the DATA without naming a memo',
        of: ['invalidate'],
        source: THREE,
        view: Three,
    },
    {
        adds: 'tags, so `refresh` reaches the DATA without naming a memo',
        of: ['refresh'],
        source: FOUR,
        view: Four,
    },
    {
        adds: 'no selector at all — everything this caller holds, tagged or not',
        of: ['refresh'],
        source: FIVE,
        view: Five,
        note: 'Reach that depends on every declaration having remembered a tag is reach that quietly shrinks as an app grows. `invalidate()` is the same form for the other verb.',
    },
]
