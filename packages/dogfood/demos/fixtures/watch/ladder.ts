// The `watch` ladder. Both rungs count BODY RUNS, which is the half of the contract values cannot show.
import type { Example } from 'harness'
import One from './1-reading-is-subscribing.abide'
import ONE from './1-reading-is-subscribing.abide?source'
import Two from './2-the-deps-are-what-it-read.abide'
import TWO from './2-the-deps-are-what-it-read.abide?source'

export const LADDER: Example[] = [
    { adds: 'reading a cell inside a `watch` IS the subscription', of: ['watch'], source: ONE, view: One },
    { adds: 'the dependency set is whatever the LAST RUN read', of: ['watch'], source: TWO, view: Two },
]
