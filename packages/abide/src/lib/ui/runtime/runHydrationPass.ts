import { hydrationWindow } from '../../shared/hydrationWindow.ts'
import { enterRenderPass } from './enterRenderPass.ts'
import { exitRenderPass } from './exitRenderPass.ts'
import { RENDER } from './RENDER.ts'
import { SEED_MARKS } from './SEED_MARKS.ts'

/*
The one owner of a hydration pass's lifecycle. A pass is four lifetimes that must open
and close together — the claim cursor (`RENDER.hydration`), the cache-withhold window
(`hydrationWindow`, which `cache.peek` reads), the block-id render pass
(`enterRenderPass`), and the two-phase seed consume (`SEED_MARKS`/`consumeSeed`,
ADR-0048): the seeds a pass adopts are only MARKED while it runs, deleted on a CLEAN
exit, and left in place on a throw — so the caller's discard→cold-rebuild recovery
re-adopts the SSR-resolved values instead of refetching (a cold refetch would leave
blocking `await` cells pending and escape as an uncaught SuspenseSignal at mount).

Both entry points (`hydrate`, the router's hydrating first mount) run through here, so
the bracket order and the throw semantics can't drift between them. Nesting is safe:
the cursor and marks save/restore, and the window/render-pass are depth-counted — a
nested pass raises and lowers without ending the outer one.
*/
export function runHydrationPass<T>(run: () => T): T {
    const previous = RENDER.hydration
    const previousMarks = SEED_MARKS.current
    RENDER.hydration = { next: new Map() }
    SEED_MARKS.current = []
    try {
        hydrationWindow.enter()
        enterRenderPass()
        try {
            const result = run()
            /* Clean pass: spend the adopted seeds, preserving the one-shot contract (a
               later mount at the same render-path re-inits fresh, never a stale snapshot). */
            for (const mark of SEED_MARKS.current) {
                delete mark.store[mark.key]
            }
            return result
        } finally {
            exitRenderPass()
            RENDER.hydration = previous
            /* Outermost exit clears the window and wakes the peeks this pass withheld for
               SSR congruence, now that the warm value is congruent to show. */
            hydrationWindow.exit()
        }
    } finally {
        SEED_MARKS.current = previousMarks
    }
}
