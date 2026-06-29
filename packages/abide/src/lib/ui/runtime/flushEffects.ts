import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'
import { updateIfNecessary } from './updateIfNecessary.ts'

/*
Drains queued effects synchronously. Each is queued when it first leaves CLEAN, but
runs only if `updateIfNecessary` finds a dependency that truly changed — a CHECK
effect whose deps all memoised back to equal values settles to CLEAN without
running its body. Double-buffers the queue each pass — swaps in a fresh array and
drains the captured one — so an effect that dirties further effects re-queues them
for the next pass rather than mutating the array mid-iteration; loops until the
graph settles. The swap reuses the drained array as the next spare, so a steady
flush allocates nothing.
*/
export function flushEffects(): void {
    /* Empty-queue fast path allocates nothing — only the length check, matching the
       old `Set.size` guard. Hot: a write with no subscribed effect (e.g. a reconcile's
       index-cell write nobody reads) still calls here at batch-exit, thousands of times
       per list op; the spare array below must not be born on that path. */
    if (REACTIVE_CONTEXT.pendingEffects.length === 0) {
        return
    }
    let spare: ReactiveNode[] = []
    do {
        const batch = REACTIVE_CONTEXT.pendingEffects
        REACTIVE_CONTEXT.pendingEffects = spare
        for (let index = 0; index < batch.length; index += 1) {
            updateIfNecessary(batch[index] as ReactiveNode)
        }
        batch.length = 0
        spare = batch
    } while (REACTIVE_CONTEXT.pendingEffects.length > 0)
}
