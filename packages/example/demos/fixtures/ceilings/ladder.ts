// Text only: this capability has nothing to render.
import type { Example } from 'abide-kit'
import ONE from './1-unset-costs-nothing.ts?source'
import TWO from './2-bound-what-is-remembered.ts?source'

export const LADDER: Example[] = [
    { adds: 'unset is the default, and unset costs nothing at all', source: ONE },
    { adds: 'bound what is remembered, without charging per write', source: TWO },
]
