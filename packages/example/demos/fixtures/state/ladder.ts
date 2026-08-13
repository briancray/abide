// The `state` ladder. Each rung is the one above it plus the one thing `adds` names.
import type { Example } from 'abide-kit'
import One from './1-own-a-value.abide'
import ONE from './1-own-a-value.abide?source'
import Two from './2-derive-from-it.abide'
import TWO from './2-derive-from-it.abide?source'
import Three from './3-a-promise-is-a-load.abide'
import THREE from './3-a-promise-is-a-load.abide?source'
import Four from './4-an-iterable-is-a-stream.abide'
import FOUR from './4-an-iterable-is-a-stream.abide?source'

export const LADDER: Example[] = [
    { adds: 'own a value, and write it by name', source: ONE, view: One },
    { adds: 'derive from it — using a cell in an expression reads it', source: TWO, view: Two },
    { adds: 'a promise is a LOAD, not a value', source: THREE, view: Three },
    { adds: 'an async iterable is a STREAM, and `chunks()` is its transcript', source: FOUR, view: Four },
]
