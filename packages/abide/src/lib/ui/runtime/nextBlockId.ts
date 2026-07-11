import { blockId } from './blockId.ts'
import { RENDER } from './RENDER.ts'

/* The next block id in the current render pass, namespaced by the ambient render-path
   (ADR-0037). `await`/`try` blocks draw it in document order WITHIN their path; a page
   id and a child component's id can never collide because they carry different paths, so
   ids stay congruent SSR↔client even when the server renders sibling children concurrently.
   Delegates to the shared `blockId` over the client's per-pass `RENDER.blockCounters` map. */
// @documentation plumbing
export function nextBlockId(): string {
    return blockId(RENDER.blockCounters)
}
