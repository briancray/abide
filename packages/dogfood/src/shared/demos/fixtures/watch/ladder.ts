// The `watch` ladder. Every rung counts BODY RUNS, which is the half of the contract values cannot show
// — an effect that woke for something it does not read still writes the right number.
//
// The ladder is two halves. Rungs 1-2 are the DISCOVERED dependency set, where reading is subscribing;
// rungs 3-4 are the DECLARED one, spelled two ways, where the handler is untracked and may read what it
// must not be woken by. Rung 5 is the teardown, which both halves have.
import type { Example } from 'harness'
import One from './1-reading-is-subscribing.abide'
import ONE from './1-reading-is-subscribing.abide?source'
import Two from './2-the-deps-are-what-it-read.abide'
import TWO from './2-the-deps-are-what-it-read.abide?source'
import Three from './3-declare-the-dependency.abide'
import THREE from './3-declare-the-dependency.abide?source'
import Four from './4-spell-it-off-the-source.abide'
import FOUR from './4-spell-it-off-the-source.abide?source'
import Five from './5-the-return-is-the-teardown.abide'
import FIVE from './5-the-return-is-the-teardown.abide?source'

export const LADDER: Example[] = [
    { adds: 'reading a cell inside a `watch` IS the subscription', of: ['watch'], source: ONE, view: One },
    { adds: 'the dependency set is whatever the LAST RUN read', of: ['watch'], source: TWO, view: Two },
    {
        adds: 'declare the dependency instead, so the handler reads without subscribing',
        of: ['watch'],
        source: THREE,
        view: Three,
    },
    { adds: 'the same declaration spelled off the source it is about', of: ['watch'], source: FOUR, view: Four },
    { adds: 'what the handler RETURNS is the teardown', of: ['watch'], source: FIVE, view: Five },
]
