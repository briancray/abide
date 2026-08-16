// Every ladder in the repo, absent until asked for — and nothing else.
//
// A LEAF, and it became one the day `/docs` grew a second axis. This map lived in `CALLABLES.ts` while
// that file was the only thing that opened a ladder; `SPELLINGS.ts` opens the same ladders against a
// different claim, and the choice was a second file importing all of `CALLABLES.ts`'s prose to reach
// one const, or the const standing on its own. That is the rule about a constant crossing a seam: its
// own UPPERCASE file, with no imports of its own but the type naming what it is keyed by.
//
// Keyed by `LadderName`, so a suite with a fixtures directory and no entry here is a type error rather
// than a ladder nothing can reach.

import type { Example } from 'harness'
import type { SuiteName } from './SUITES.ts'

/** A suite whose fixtures directory holds a ladder. `overview` is the hub and has none. */
export type LadderName = Exclude<SuiteName, 'overview'>

export const LADDERS: Record<LadderName, () => Promise<{ LADDER: Example[] }>> = {
    state: () => import('./fixtures/state/ladder.ts'),
    memo: () => import('./fixtures/memo/ladder.ts'),
    verbs: () => import('./fixtures/verbs/ladder.ts'),
    channel: () => import('./fixtures/channel/ladder.ts'),
    watch: () => import('./fixtures/watch/ladder.ts'),
    scope: () => import('./fixtures/scope/ladder.ts'),
    routing: () => import('./fixtures/routing/ladder.ts'),
    template: () => import('./fixtures/template/ladder.ts'),
    client: () => import('./fixtures/client/ladder.ts'),
    server: () => import('./fixtures/server/ladder.ts'),
    hydrate: () => import('./fixtures/hydrate/ladder.ts'),
    transport: () => import('./fixtures/transport/ladder.ts'),
    responses: () => import('./fixtures/responses/ladder.ts'),
    request: () => import('./fixtures/request/ladder.ts'),
    logging: () => import('./fixtures/logging/ladder.ts'),
    health: () => import('./fixtures/health/ladder.ts'),
    identity: () => import('./fixtures/identity/ladder.ts'),
    config: () => import('./fixtures/config/ladder.ts'),
    lifecycle: () => import('./fixtures/lifecycle/ladder.ts'),
    ceilings: () => import('./fixtures/ceilings/ladder.ts'),
    compiler: () => import('./fixtures/compiler/ladder.ts'),
}

/**
 * The rungs of the named ladders that make a CLAIM, in ladder order.
 *
 * One walk for both axes: `/docs/<callable>` asks for the rungs claiming a name in `of`, and
 * `/docs/syntax/<spelling>` for the ones claiming a slug in `spells`. The two lists never overlap in
 * what they ask for and always overlap in how they ask, which is the whole of what is shared here.
 *
 * The rungs of a ladder stay in THAT ladder's order, because the order is the content: rung 4 of
 * `request` is rung 3 plus one thing, and reordering them by anything else would break the only
 * property that makes a rung small enough to read.
 */
export async function claimed(
    ladders: LadderName[],
    claims: (rung: Example) => readonly string[] | undefined,
    name: string,
): Promise<Example[]> {
    // Opened together rather than one after the next: the ladders of a name on two of them have no
    // dependency on each other, so awaiting inside the loop serialised two chunk loads for nothing.
    const opened = await Promise.all(ladders.map((ladder) => LADDERS[ladder]()))
    const found: Example[] = []
    for (const { LADDER } of opened) {
        for (const rung of LADDER) {
            if (claims(rung)?.includes(name)) found.push(rung)
        }
    }
    return found
}
