import { hydrationWindow } from '../../shared/hydrationWindow.ts'
import { enterRenderPass } from './enterRenderPass.ts'
import { exitRenderPass } from './exitRenderPass.ts'
import { RENDER } from './RENDER.ts'
import { restoreWarmSeeds } from './restoreWarmSeeds.ts'

/*
The one owner of a hydration pass's lifecycle. A pass is three lifetimes that must open
and close together — the claim cursor (`RENDER.hydration`), the cache-withhold window
(`hydrationWindow`, which `cache.peek` reads), and the block-id render pass
(`enterRenderPass`) — plus one recovery obligation: a pass CONSUMES the warm-seed
manifests as it adopts (each `CELL_SEED`/`DOC_SEED` key is deleted on read), so a pass
that THROWS must restore them before the caller's cold rebuild, or the rebuilt cells
refetch pending and a top-level blocking read escapes as an uncaught SuspenseSignal.

Both entry points (`hydrate`, the router's hydrating first mount) run through here, so
the bracket order and the restore-on-throw can't drift between them. Nesting is safe:
the cursor save/restores, and the window/render-pass are depth-counted — a nested pass
raises and lowers without ending the outer one.
*/
export function runHydrationPass<T>(run: () => T): T {
    const previous = RENDER.hydration
    RENDER.hydration = { next: new Map() }
    hydrationWindow.enter()
    enterRenderPass()
    try {
        return run()
    } catch (error) {
        /* Undo the pass's consume-once seed deletes so the caller's discard→cold-rebuild
           recovery re-adopts the SSR-resolved values instead of refetching cold. */
        restoreWarmSeeds()
        throw error
    } finally {
        exitRenderPass()
        RENDER.hydration = previous
        /* Outermost exit clears the window and wakes the peeks this pass withheld for
           SSR congruence, now that the warm value is congruent to show. */
        hydrationWindow.exit()
    }
}
