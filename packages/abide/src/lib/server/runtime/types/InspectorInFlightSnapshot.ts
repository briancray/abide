import type { InspectorInFlightRequest } from './InspectorInFlightRequest.ts'

/*
The requests executing their handler at snapshot time — a point-in-time read of
the in-flight set, the live counterpart to the closing records the Logs tab
shows once a request settles. Empty when the server is idle.
*/
export type InspectorInFlightSnapshot = {
    requests: InspectorInFlightRequest[]
}
