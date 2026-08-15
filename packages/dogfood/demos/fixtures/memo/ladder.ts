// The `memo` ladder. Each rung is the one above it plus the one thing `adds` names.
import type { Example } from 'harness'
import One from './1-derive-one.abide'
import ONE from './1-derive-one.abide?source'
import Two from './2-load-one.abide'
import TWO from './2-load-one.abide?source'
import Three from './3-say-what-to-show-meanwhile.abide'
import THREE from './3-say-what-to-show-meanwhile.abide?source'
import FOUR from './4-a-read-that-signals.ts?source'

export const LADDER: Example[] = [
    { adds: 'derive one — no args, so the body is the dependency set', of: ['memo'], source: ONE, view: One },
    { adds: 'load one — declaring args makes them the cache key', of: ['memo'], source: TWO, view: Two },
    { adds: 'say what to show meanwhile, with nothing awaiting', of: ['memo'], source: THREE, view: Three },
    { adds: 'hand the signal back when your own `catch` swallows it', of: ['isPending'], source: FOUR },
]
