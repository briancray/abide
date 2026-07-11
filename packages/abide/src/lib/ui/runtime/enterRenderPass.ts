import { RENDER } from './RENDER.ts'

/* Marks entry into a render/mount. The OUTERMOST one (depth 0) clears the per-path
   block-id counters so every render pass starts each path at 0 (a re-navigation to the
   same route must not continue a prior pass's counter); a child component's render/mount
   runs at depth > 0 and continues the same map. Pair with `exitRenderPass`. */
// @documentation plumbing
export function enterRenderPass(): void {
    if (RENDER.depth === 0) {
        RENDER.blockCounters.clear()
    }
    RENDER.depth += 1
}
