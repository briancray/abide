// The `state` ladder. Each rung is the one above it plus the one thing `adds` names.
//
// Sugar first and the explicit spelling at rung 5, which is the order a reader meets them in rather
// than the order they were built in: `count++` is what a `.abide` file looks like, and `count.set(…)`
// is what it means. The last three change WHERE the cell lives — through a transform, out to module
// scope, and finally keyed by a name — so each is the same cell asked one more question.
import type { Example } from 'harness'
import One from './1-own-a-value.abide'
import ONE from './1-own-a-value.abide?source'
import Two from './2-derive-from-it.abide'
import TWO from './2-derive-from-it.abide?source'
import Three from './3-a-promise-is-a-load.abide'
import THREE from './3-a-promise-is-a-load.abide?source'
import Four from './4-an-iterable-is-a-stream.abide'
import FOUR from './4-an-iterable-is-a-stream.abide?source'
import Five from './5-the-explicit-spelling.abide'
import FIVE from './5-the-explicit-spelling.abide?source'
import Six from './6-every-write-passes-through.abide'
import SIX from './6-every-write-passes-through.abide?source'
import Seven from './7-a-cell-outlives-a-render.abide'
import SEVEN from './7-a-cell-outlives-a-render.abide?source'
import Eight from './8-one-cell-by-name.abide'
import EIGHT from './8-one-cell-by-name.abide?source'

export const LADDER: Example[] = [
    { adds: 'own a value, and write it by name', of: ['state'], source: ONE, view: One },
    { adds: 'derive from it — using a cell in an expression reads it', of: ['state'], source: TWO, view: Two },
    { adds: 'a promise is a LOAD, not a value', of: ['state'], source: THREE, view: Three },
    { adds: 'an async iterable is a STREAM, and `chunks()` is its transcript', of: ['state'], source: FOUR, view: Four },
    {
        adds: 'the explicit spelling every rung above is sugar over, which never stops compiling',
        of: ['state'],
        source: FIVE,
        view: Five,
    },
    {
        adds: 'a TRANSFORM, so every write passes through one place before storage',
        of: ['state'],
        source: SIX,
        view: Six,
    },
    {
        adds: 'module scope, so one cell outlives any single render and is shared per CALLER',
        of: ['state'],
        source: SEVEN,
        view: Seven,
    },
    {
        adds: 'one cell by NAME rather than by reference, which module scope cannot do',
        of: ['state'],
        source: EIGHT,
        view: Eight,
    },
]
