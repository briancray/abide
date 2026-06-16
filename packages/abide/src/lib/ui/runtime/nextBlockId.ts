import { RENDER } from './RENDER.ts'

/* The next block id in the current render pass. `await`/`try` blocks draw from it
   in document order — shared across a component and the children it inlines — so a
   page id and a child component's id never collide in the global `RESUME` manifest. */
// @readme plumbing
export function nextBlockId(): number {
    const id = RENDER.blockId
    RENDER.blockId += 1
    return id
}
