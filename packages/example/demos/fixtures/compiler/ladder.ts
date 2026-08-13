// The sugar, one spelling at a time. What comes out is an `html` template indistinguishable from a
// hand-written one.
import type { Example } from 'abide-kit'
import One from './1-read-and-write-by-name.abide'
import ONE from './1-read-and-write-by-name.abide?source'
import Two from './2-a-cell-alone-is-the-cell.abide'
import TWO from './2-a-cell-alone-is-the-cell.abide?source'
import Three from './3-derive-without-declaring.abide'
import THREE from './3-derive-without-declaring.abide?source'

export const LADDER: Example[] = [
    { adds: 'read and write by NAME — and the explicit spelling still compiles', source: ONE, view: One },
    { adds: 'naming a cell alone hands over the CELL rather than reading it', source: TWO, view: Two },
    { adds: 'so a derivation declares no dependencies at all', source: THREE, view: Three },
]
