import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installAmbientScopeStore } from '../src/lib/server/runtime/installAmbientScopeStore.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import type { RequestStore } from '../src/lib/server/runtime/types/RequestStore.ts'
import { createScope } from '../src/lib/ui/createScope.ts'
import { ambientPathBacking } from '../src/lib/ui/runtime/ambientPathBacking.ts'
import { ambientScopeBacking } from '../src/lib/ui/runtime/ambientScopeBacking.ts'
import { CURRENT_PATH } from '../src/lib/ui/runtime/CURRENT_PATH.ts'
import { withPath } from '../src/lib/ui/runtime/withPath.ts'
import { withPathFrom } from '../src/lib/ui/runtime/withPathFrom.ts'

/*
ADR-0033: the SSR render-path must survive a render's awaits. A render's `build()` returns a
PENDING promise awaited OUTSIDE the path wrapper, so a mutable-slot-restored-in-finally backing
snaps the ambient path back to the ancestor the instant the render yields — every scope created
after the first await (a second sibling child, a block after a page barrier, a child two awaits
deep) then composes an id against the wrong base. D1 backs the path with `AsyncLocalStorage.run`,
so a resumed continuation inherits its own path.

The proof: the SSR-composed scope id (async render body, awaits inline) must EQUAL the
client-composed id (the client mount is synchronous, so its composition is the ground truth). We
run under the server backing (`installAmbientScopeStore` + a request scope) — that is where the
fix lives; the client's synchronous module-var backing never needs across-await survival.
*/

/* Restore the default (module-var) backings so this install never leaks into other suites. */
const defaultScopeBacking = ambientScopeBacking.active
const defaultPathBacking = ambientPathBacking.active
beforeEach(() => {
    installAmbientScopeStore()
})
afterEach(() => {
    ambientScopeBacking.active = defaultScopeBacking
    ambientPathBacking.active = defaultPathBacking
})

const store = (): RequestStore => ({}) as unknown as RequestStore
const tick = (): Promise<void> => Promise.resolve()

describe('render-path survives a render’s awaits (ADR-0033 D1)', () => {
    /* (a) The SECOND sibling child in a layer. Child A is the parent's first await; the base must
       still be `page` when child B's `$$withPath(1, …)` runs, so B composes `page/1`, not `1`. */
    test('second sibling child composes against the enclosing render’s path', async () => {
        const bId = await requestContext.run(store(), () =>
            withPath('page', async () => {
                // child A (ordinal 0) — an awaited async render, the parent's first await
                await withPath(0, async () => {
                    await tick()
                })
                // child B (ordinal 1) — its scope id, composed after A's await resolved
                return withPath(1, () => createScope({}, undefined, false).id)
            }),
        )
        // Client-composed ground truth: withPath('page') → withPath(1) → 'page/1'
        expect(bId).toBe('page/1')
    })

    /* (b) A block after a page-level async-cell barrier. The page awaits its blocking cell before
       it reaches a later {#each}/{#if}; that block must compose against `page`, not the empty base. */
    test('a block after a page barrier composes against the page path', async () => {
        const blockId = await requestContext.run(store(), () =>
            withPath('page', async () => {
                await tick() // the Tier-2 blocking cell barrier
                // a later {#each} row (a captured-base withPathFrom, as the block emits)
                return withPathFrom(
                    CURRENT_PATH.current,
                    'row-0',
                    () => createScope({}, undefined, false).id,
                )
            }),
        )
        // Client-composed ground truth: withPath('page') → withPathFrom('page','row-0') → 'page/row-0'
        expect(blockId).toBe('page/row-0')
    })

    /* (c) A child two awaits deep — the base must survive transitively through nested async bodies. */
    test('a scope two awaits deep composes the full nested path', async () => {
        const deepId = await requestContext.run(store(), () =>
            withPath('page', () =>
                withPath(0, async () => {
                    await tick() // await #1 (the child render)
                    return withPath(0, async () => {
                        await tick() // await #2 (the grandchild render)
                        return createScope({}, undefined, false).id
                    })
                }),
            ),
        )
        // Client-composed ground truth: page → 0 → 0 → 'page/0/0'
        expect(deepId).toBe('page/0/0')
    })
})
