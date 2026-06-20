import { RENDER } from './RENDER.ts'

/* Marks entry into a render/mount. The OUTERMOST one (depth 0) resets the block-id
   counter so every render pass starts at 0; a child component's render/mount runs
   at depth > 0 and continues the parent's counter. Pair with `exitRenderPass`. */
// @documentation plumbing
export function enterRenderPass(): void {
    if (RENDER.depth === 0) {
        RENDER.blockId = 0
    }
    RENDER.depth += 1
}
