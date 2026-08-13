// The `memo` ladder. Each rung is the one above it plus the one thing `adds` names.
import type { Example } from 'abide-kit'
import One from './1-derive-one.abide'
import ONE from './1-derive-one.abide?source'
import Two from './2-load-one.abide'
import TWO from './2-load-one.abide?source'
import Three from './3-say-what-to-show-meanwhile.abide'
import THREE from './3-say-what-to-show-meanwhile.abide?source'

export const LADDER: Example[] = [
    { adds: 'derive one — no args, so the body is the dependency set', source: ONE, view: One },
    { adds: 'load one — declaring args makes them the cache key', source: TWO, view: Two },
    { adds: 'say what to show meanwhile, with nothing awaiting', source: THREE, view: Three },
]
