// Text only: this capability is about WHO is asking, and a page has only one asker.
import type { Example } from 'harness'
import ONE from './1-per-caller-by-default.ts?source'
import TWO from './2-opt-into-one-cache.ts?source'

export const LADDER: Example[] = [
    { adds: "a memo's cache is PER CALLER, which is the only default a server can have", of: ['memo'], source: ONE },
    {
        adds: '`{ global }` — one cache for the process, for what does not depend on who asked',
        of: ['memo'],
        source: TWO,
    },
]
