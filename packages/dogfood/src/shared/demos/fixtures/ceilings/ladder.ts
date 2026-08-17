// The `ceilings` ladder. A ceiling is what the SERVING process was told, so each rung is the endpoint
// that reads one back and the browser half that asks it — the numbers in the previews are this app's,
// and restarting it with one of the three set in the environment is what moves them.
import type { Example } from 'harness'
import One from './1-unset-costs-nothing.abide'
import ONE_CLIENT from './1-unset-costs-nothing.abide?source'
import Two from './2-bound-what-is-remembered.abide'
import TWO_CLIENT from './2-bound-what-is-remembered.abide?source'
import ONE from '#server/rpc/docs/ceilings/unset-costs-nothing.ts?source'
import TWO from '#server/rpc/docs/ceilings/bound-what-is-remembered.ts?source'

export const LADDER: Example[] = [
    {
        adds: 'unset is the default, and unset costs nothing at all',
        of: ['config'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: 'bound what is remembered, without charging per write',
        of: ['config'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
]
