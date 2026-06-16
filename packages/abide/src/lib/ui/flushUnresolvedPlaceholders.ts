import { refetchPlaceholder } from './refetchPlaceholder.ts'
import type { StreamingDeferred } from './types/StreamingDeferred.ts'

/*
Drains any placeholder the resolution stream never settled — a clean EOF with
leftovers, or a cut (idleTimeout cap, dropped connection). Each unresolved
deferred re-fetches its request live, so the {#await} resolves from a normal
request instead of hanging on a deferred that will never settle. A fully-drained
stream leaves the registry empty, so this is a no-op then.
*/
export function flushUnresolvedPlaceholders(deferreds: Map<string, StreamingDeferred>): void {
    for (const deferred of deferreds.values()) {
        refetchPlaceholder(deferred)
    }
    deferreds.clear()
}
