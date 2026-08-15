// Text only: this capability has nothing to render.
import type { Example } from 'harness'
import ONE from './1-read-the-environment.ts?source'
import TWO from './2-declare-your-own-defaults.ts?source'

export const LADDER: Example[] = [
    { adds: 'read the environment, typed, from one place', of: ['config'], source: ONE },
    { adds: 'declare your own defaults — under what the operator declared', of: ['onConfig'], source: TWO },
]
