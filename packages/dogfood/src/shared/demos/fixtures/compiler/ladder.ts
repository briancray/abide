// The sugar, one spelling at a time. What comes out is an `html` template indistinguishable from a
// hand-written one.
import type { Example } from 'harness'
import One from './1-read-and-write-by-name.abide'
import ONE from './1-read-and-write-by-name.abide?source'
import Two from './2-a-state-alone-is-the-state.abide'
import TWO from './2-a-state-alone-is-the-state.abide?source'
import Three from './3-derive-without-declaring.abide'
import THREE from './3-derive-without-declaring.abide?source'

export const LADDER: Example[] = [
    {
        adds: 'read and write by NAME — and the explicit spelling still compiles',
        of: ['state'],
        source: ONE,
        view: One,
    },
    {
        adds: 'naming a state alone hands over the STATE rather than reading it',
        of: ['state'],
        source: TWO,
        view: Two,
    },
    { adds: 'so a derivation declares no dependencies at all', of: ['memo'], source: THREE, view: Three },
]
