import { RENDER } from './RENDER.ts'

/* Marks exit from a render/mount, unwinding the depth `enterRenderPass` raised. */
// @documentation plumbing
export function exitRenderPass(): void {
    RENDER.depth -= 1
}
