import { inFlightRequests } from './inFlightRequests.ts'
import type { InspectorInFlightRequest } from './types/InspectorInFlightRequest.ts'
import type { InspectorInFlightSnapshot } from './types/InspectorInFlightSnapshot.ts'
import type { RequestStore } from './types/RequestStore.ts'

function projectStore(store: RequestStore, now: number): InspectorInFlightRequest {
    return {
        trace: store.trace.traceId,
        method: store.req.method,
        path: `${store.url.pathname}${store.url.search}`,
        /* store.start is Bun.nanoseconds() at scope entry; elapsed is current at the read. */
        elapsedMs: (now - store.start) / 1e6,
        route: store.route,
        params: store.params,
    }
}

/*
Snapshots the request scopes currently executing their handler. Read at call
time so it reflects the in-flight set as it stands; returns empty when the
inspector hasn't installed the tracking Set or the server is idle. Sorted by
elapsed ascending — newest (least elapsed) first, so a long-running request
sinks to the bottom as its elapsed grows.
*/
export function buildInFlightSnapshot(): InspectorInFlightSnapshot {
    const tracked = inFlightRequests.tracked
    if (!tracked) {
        return { requests: [] }
    }
    const now = Bun.nanoseconds()
    const requests = Array.from(tracked, (store) => projectStore(store, now)).sort(
        (left, right) => left.elapsedMs - right.elapsedMs,
    )
    return { requests }
}
