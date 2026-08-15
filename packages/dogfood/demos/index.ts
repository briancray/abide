// Every suite MODULE, for the two consumers that genuinely need all of them: the test runners and
// the bench page. Its metadata is in `SUITES.ts`, and the split is the point.
//
// A page does NOT come through here — it reaches ONE suite through `LOADERS`, so its chunk
// is that suite and nothing else. Routing every page through one list put every suite in every
// page, which was invisible until `compiler` joined it and dragged TypeScript's scanner along:
// ~700 kB of compiler on `/state`, on `/watch`, on every page with nothing to do with compiling.
//
// The loaders are keyed by `SuiteName`, so a suite listed in `ORDER` and missing here is a type
// error rather than a suite that quietly never runs.

import type { Suite } from 'harness'
import { ORDER, type SuiteName } from './SUITES.ts'

export { META, NAV, ORDER, type SuiteMeta, type SuiteName } from './SUITES.ts'

/**
 * Every suite, reachable by name and absent until asked for.
 *
 * Exported because `pages/tests/[suite]/` is one page for twenty routes: the segment is the key, and each
 * entry being an `import()` is what keeps that page's chunk free of every suite it might show.
 */
export const LOADERS: Record<SuiteName, () => Promise<{ default: Suite }>> = {
    overview: () => import('./overview.ts'),
    state: () => import('./state.ts'),
    memo: () => import('./memo.ts'),
    verbs: () => import('./verbs.ts'),
    channel: () => import('./channel.ts'),
    watch: () => import('./watch.ts'),
    scope: () => import('./scope.ts'),
    routing: () => import('./routing.ts'),
    template: () => import('./template.ts'),
    client: () => import('./client.ts'),
    server: () => import('./server.ts'),
    hydrate: () => import('./hydrate.ts'),
    transport: () => import('./transport.ts'),
    responses: () => import('./responses.ts'),
    request: () => import('./request.ts'),
    logging: () => import('./logging.ts'),
    health: () => import('./health.ts'),
    identity: () => import('./identity.ts'),
    config: () => import('./config.ts'),
    lifecycle: () => import('./lifecycle.ts'),
    ceilings: () => import('./ceilings.ts'),
    compiler: () => import('./compiler.ts'),
}

/** Every suite, in nav order. */
export async function allSuites(): Promise<Suite[]> {
    const loaded: Suite[] = []
    for (const name of ORDER) loaded.push((await LOADERS[name]()).default)
    return loaded
}

// `benched()` was here — every case carrying a bench, tagged with its suite — and it went with the row
// building it existed for: `harness`'s `benchRowsOf` walks the suites itself, so the pair of a suite
// and an INDEX into its cases is a shape nothing needs any more.
