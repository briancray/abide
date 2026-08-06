// Every suite MODULE, for the two consumers that genuinely need all of them: the test runners and
// the bench page. Its metadata is in `SUITES.ts`, and the split is the point.
//
// A page does NOT come through here — `web/state.ts` imports `demos/state.ts` by name, so its bundle
// is its own suite and nothing else. Routing every page through one list put every suite in every
// page, which was invisible until `compiler` joined it and dragged TypeScript's scanner along:
// ~700 kB of compiler on `/state`, on `/watch`, on every page with nothing to do with compiling.
//
// The loaders are keyed by `SuiteName`, so a suite listed in `ORDER` and missing here is a type
// error rather than a suite that quietly never runs.

import type { Suite } from 'abide/tests'
import { ORDER, type SuiteName } from './SUITES.ts'

export { META, NAV, ORDER, type SuiteMeta, type SuiteName } from './SUITES.ts'

const LOADERS: Record<SuiteName, () => Promise<{ default: Suite }>> = {
    overview: () => import('./overview.ts'),
    state: () => import('./state.ts'),
    memo: () => import('./memo.ts'),
    verbs: () => import('./verbs.ts'),
    channel: () => import('./channel.ts'),
    watch: () => import('./watch.ts'),
    scope: () => import('./scope.ts'),
    template: () => import('./template.ts'),
    client: () => import('./client.ts'),
    server: () => import('./server.ts'),
    hydrate: () => import('./hydrate.ts'),
    compiler: () => import('./compiler.ts'),
}

/** Every suite, in nav order. */
export async function allSuites(): Promise<Suite[]> {
    const loaded: Suite[] = []
    for (const name of ORDER) loaded.push((await LOADERS[name]()).default)
    return loaded
}

/** Every case that carries a bench, tagged with the suite it came from. */
export async function benched(): Promise<{ suite: Suite; index: number }[]> {
    const out: { suite: Suite; index: number }[] = []
    for (const suite of await allSuites()) {
        for (let i = 0; i < suite.cases.length; i++) {
            if (suite.cases[i]?.bench !== undefined) out.push({ suite, index: i })
        }
    }
    return out
}
