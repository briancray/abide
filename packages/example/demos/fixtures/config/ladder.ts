// Text only: this capability has nothing to render.
import type { Example } from 'abide-kit'
import ONE from './1-read-the-environment.ts?source'
import TWO from './2-declare-your-own-defaults.ts?source'

export const LADDER: Example[] = [
    { adds: 'read the environment, typed, from one place', source: ONE },
    { adds: 'declare your own defaults — under what the operator declared', source: TWO },
]
