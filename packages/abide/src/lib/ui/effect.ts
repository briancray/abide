import { CURRENT_SCOPE } from './runtime/CURRENT_SCOPE.ts'
import { createEffectNode } from './runtime/createEffectNode.ts'
import { inScope } from './runtime/inScope.ts'
import type { EffectResult } from './runtime/types/EffectResult.ts'

/*
Runs `fn` now, capturing every reactive cell it reads, then re-runs it whenever
any of those change. `fn` may return a teardown — run before each re-run and on
dispose — and may be async (its teardown then runs once the promise settles, but
only the reads before its first `await` are tracked). Returns a dispose that runs
the final teardown and detaches it from the graph. This is abide's from-scratch
effect primitive: the open-on-first-read / close-on-last-reader lifecycle,
grounded in abide's own reactive core.
*/
// @documentation effect
export function effect(fn: () => EffectResult): () => void {
    /* Re-runs fire after the build, so pin the scope this effect was created under
       (the dep-tracking observer is managed separately, so this can't disturb it). */
    const captured = CURRENT_SCOPE.current
    return createEffectNode(() => inScope(captured, fn))
}
