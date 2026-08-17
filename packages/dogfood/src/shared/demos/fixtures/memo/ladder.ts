// The `memo` ladder. Each rung is the one above it plus the one thing `adds` names.
//
// Rungs 1-4 are the two shapes and what a read signals; 5-7 are the third argument — the options
// record — one option at a time, because `ttl`, the pacing pair and the transform are three unrelated
// answers that happen to be written in the same place. 8 turns 7 around: the same two functions read
// as a dependency set and an untracked body, which is the one arm of `memo` that can load twice.
import type { Example } from 'harness'
import One from './1-derive-one.abide'
import ONE from './1-derive-one.abide?source'
import Two from './2-load-one.abide'
import TWO from './2-load-one.abide?source'
import Three from './3-say-what-to-show-meanwhile.abide'
import THREE from './3-say-what-to-show-meanwhile.abide?source'
import Four from './4-a-read-that-signals.abide'
import FOUR from './4-a-read-that-signals.abide?source'
import Five from './5-how-long-a-slot-is-served.abide'
import FIVE from './5-how-long-a-slot-is-served.abide?source'
import Six from './6-pace-the-revalidation.abide'
import SIX from './6-pace-the-revalidation.abide?source'
import Seven from './7-a-transform-between-the-two.abide'
import SEVEN from './7-a-transform-between-the-two.abide?source'
import Eight from './8-the-transform-may-load.abide'
import EIGHT from './8-the-transform-may-load.abide?source'

export const LADDER: Example[] = [
    { adds: 'derive one — no args, so the body is the dependency set', of: ['memo'], source: ONE, view: One },
    { adds: 'load one — declaring args makes them the cache key', of: ['memo'], source: TWO, view: Two },
    { adds: 'say what to show meanwhile, with nothing awaiting', of: ['memo'], source: THREE, view: Three },
    { adds: 'your own `catch` cannot swallow the signal — the value it builds is discarded', of: ['memo'], source: FOUR, view: Four },
    { adds: 'how long a settled slot is served, and why that is a read and not a timer', of: ['memo'], source: FIVE, view: Five },
    { adds: 'pace the revalidation — and a cold slot is never paced', of: ['memo'], source: SIX, view: Six },
    { adds: 'a transform between the body and the options, so the memo IS its return', of: ['memo'], source: SEVEN, view: Seven },
    { adds: 'read the same pair as DECLARED DEPENDENCIES, and let the untracked body load', of: ['memo'], source: EIGHT, view: Eight },
]
