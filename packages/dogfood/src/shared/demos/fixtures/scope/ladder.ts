// The `scope` ladder. This capability is about WHO is asking, and the page a reader is on has only one
// asker — so the previews press a button that opens a real request, twice, and the difference between
// the two rungs is which number stops moving.
import type { Example } from 'harness'
import One from './1-per-caller-by-default.abide'
import ONE_CLIENT from './1-per-caller-by-default.abide?source'
import Two from './2-opt-into-one-cache.abide'
import TWO_CLIENT from './2-opt-into-one-cache.abide?source'
import ONE from '#server/rpc/docs/scope/per-caller-by-default.ts?source'
import TWO from '#server/rpc/docs/scope/opt-into-one-cache.ts?source'

export const LADDER: Example[] = [
    {
        adds: "a memo's cache is PER CALLER, which is the only default a server can have",
        of: ['memo'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: '`{ global }` — one cache for the process, for what does not depend on who asked',
        of: ['memo'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
]
