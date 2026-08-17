// The `config` ladder. What a process was TOLD is the serving process's own, so both rungs are two
// files: the declaration, and the browser half that asks this app what its answer actually is.
//
// Rung 2's server half is a hook rather than an endpoint, and it is a REAL one — `packages/dogfood/app.ts`
// exports it, which is why the preview reads a value back instead of describing one. The endpoint it
// reads through is rung 1's, one step up the ladder.
import type { Example } from 'harness'
import One from './1-read-the-environment.abide'
import ONE_CLIENT from './1-read-the-environment.abide?source'
import Two from './2-declare-your-own-defaults.abide'
import TWO_CLIENT from './2-declare-your-own-defaults.abide?source'
import TWO from './2-declare-your-own-defaults.ts?source'
import ONE from '#server/rpc/docs/config/read-the-environment.ts?source'

export const LADDER: Example[] = [
    {
        adds: 'read the environment, typed, from one place',
        of: ['config'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: 'declare your own defaults — under what the operator declared',
        of: ['onConfig'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
]
