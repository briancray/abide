import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import { updateIfNecessary } from './updateIfNecessary.ts'

/*
Drains queued effects synchronously. Each is queued when it first leaves CLEAN, but
runs only if `updateIfNecessary` finds a dependency that truly changed — a CHECK
effect whose deps all memoised back to equal values settles to CLEAN without
running its body. Snapshots and clears the queue each pass so an effect that dirties
further effects re-queues them for the next pass rather than mutating the set
mid-iteration; loops until the graph settles.
*/
export function flushEffects(): void {
    while (REACTIVE_CONTEXT.pendingEffects.size > 0) {
        const batch = [...REACTIVE_CONTEXT.pendingEffects]
        REACTIVE_CONTEXT.pendingEffects.clear()
        for (const node of batch) {
            updateIfNecessary(node)
        }
    }
}
