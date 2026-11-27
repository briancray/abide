// Builds one browser bench — `bench/<name>Injectable.ts` — into one IIFE's source a page can be
// injected with, for a spec to `await buildBench('list')`. The build is the harness's own
// `buildInjectable`, over this entry rather than its MEASURE lane's: what keeps abide out of that
// lane is its entry's graph, not the build.

import type { batch, claimOf, emulatedDom, ratio } from '@abide/harness/report'

import { buildInjectable } from '../../harness/scripts/buildInjectable.ts'
import type { runArms } from './armsRun.ts'

/** Builds `bench/<name>Injectable.ts` into an IIFE and returns its source. */
export function buildBench(name: string): Promise<string> {
    return buildInjectable(
        new URL(`./${name}Injectable.ts`, import.meta.url).pathname,
    )
}

/** What `buildBench('report')` leaves on the page's `globalThis.__REPORT__`. */
export type Report = {
    batch: typeof batch
    claimOf: typeof claimOf
    emulatedDom: typeof emulatedDom
    ratio: typeof ratio
    runArms: typeof runArms
}
