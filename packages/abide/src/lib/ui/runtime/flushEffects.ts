import { NODE_STATE } from './NODE_STATE.ts'
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

Raises `batchDepth` for the whole drain so a write inside an effect body queues
rather than re-entering the flush: `trigger` gates its flush on `batchDepth === 0`,
and re-entry would run a just-dirtied effect nested — ahead of effects already in
this pass and on a JS stack that grows with the write chain. Suppressed, the
newly-dirtied effect falls to the `do…while` and runs in queue (creation) order.
*/
export function flushEffects(): void {
    /* Empty-queue fast path allocates nothing — only the length check, matching the
       old `Set.size` guard. Hot: a write with no subscribed effect (e.g. a reconcile's
       index-cell write nobody reads) still calls here at batch-exit, thousands of times
       per list op; the spare array below must not be born on that path. */
    if (REACTIVE_CONTEXT.pendingEffects.length === 0) {
        return
    }
    /* Always entered at depth 0 (trigger/batch-exit gate on it); the bump makes the
       drain non-reentrant, restored in `finally` so a throwing effect body can't strand
       the graph batched. */
    REACTIVE_CONTEXT.batchDepth += 1
    try {
        drain()
    } finally {
        REACTIVE_CONTEXT.batchDepth -= 1
    }
}

function drain(): void {
    let spare: ReactiveNode[] = []
    let errors: unknown[] | undefined
    do {
        const batch = REACTIVE_CONTEXT.pendingEffects
        REACTIVE_CONTEXT.pendingEffects = spare
        for (let index = 0; index < batch.length; index += 1) {
            const node = batch[index] as ReactiveNode
            try {
                updateIfNecessary(node)
            } catch (error) {
                /* One effect throwing must not strand the effects queued behind it — they
                   live in this same `batch`, which becomes unreachable the moment we swap
                   `pendingEffects`. Reset the culprit to CLEAN so a later write to its
                   dependencies can re-queue it (otherwise `mark`'s CLEAN→dirty gate leaves
                   it permanently inert), then keep draining and surface the error(s) once
                   the graph has settled rather than swallowing them. */
                node.status = NODE_STATE.CLEAN
                if (errors === undefined) {
                    errors = []
                }
                errors.push(error)
            }
        }
        batch.length = 0
        spare = batch
    } while (REACTIVE_CONTEXT.pendingEffects.length > 0)
    if (errors !== undefined) {
        throw errors.length === 1
            ? errors[0]
            : new AggregateError(errors, 'abide: effects threw during flush')
    }
}
