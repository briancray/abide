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
    {
        adds: 'own a value, and write it by name',
        note:
            'There is no hook and no place this has to be called from — `state(0)` at the top of a ' +
            '`<script>` is a `const` that happens to be reactive.',
        of: ['state'],
        source: ONE,
        view: One,
    },
    {
        adds: 'derive from it — using a cell in an expression reads it',
        note:
            'Naming the cell alone hands over the CELL; using it in an expression READS it. Which one ' +
            'happens is decided syntactically, so nothing in the emit path needs a type-checker to tell.',
        of: ['state'],
        source: TWO,
        view: Two,
    },
    {
        adds: 'a promise is a LOAD, not a value',
        note:
            'The rung most often reached by accident: `state(fetchRows())` looks like it stores a promise ' +
            'and does not, so a read is the resolved value and a `.then` on it has nothing to attach to.',
        of: ['state'],
        source: THREE,
        view: Three,
    },
    {
        adds: 'an async iterable is a STREAM, and `chunks()` is its transcript',
        note:
            'The read is the LATEST chunk and `chunks()` is everything that arrived, so a reader that ' +
            'wants the whole stream and asks the cell gets only the last thing to land.',
        of: ['state'],
        source: FOUR,
        view: Four,
    },
    {
        adds: 'the explicit spelling every rung above is sugar over, which never stops compiling',
        note:
            'The one rung that adds no behaviour: everything above compiles to this. A plain `.ts` file ' +
            'writes it out, and a `.abide` file may — the sugar is over it, never instead of it.',
        of: ['state'],
        source: FIVE,
        view: Five,
    },
    {
        adds: 'a TRANSFORM, so every write passes through one place before storage',
        note:
            'It runs on the `initial` as well as on every write, so the cell cannot hold a value the ' +
            'transform would not have produced — including the one it was declared with.',
        of: ['state'],
        source: SIX,
        view: Six,
    },
    {
        adds: 'module scope, so one cell outlives any single render and is shared per CALLER',
        note:
            'Per CALLER, not per process: one per request on a server and one per page in a browser. ' +
            'Reading it as "a global" is how one visitor’s value turns up on another’s page.',
        of: ['state'],
        source: SEVEN,
        view: Seven,
    },
    {
        adds: 'one cell by NAME rather than by reference, which module scope cannot do',
        note:
            'Two files that never import each other reach the same cell, and the FIRST call decides its ' +
            'value — a later one gets what is already there, initial argument and all.',
        of: ['state'],
        source: EIGHT,
        view: Eight,
    },
]
