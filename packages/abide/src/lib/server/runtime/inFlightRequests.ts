import type { RequestStore } from './types/RequestStore.ts'

/*
The set of request scopes currently executing their handler, for the inspector's
in-flight view. `tracked` stays undefined until the inspector mounts and swaps in
a live Set — so the request path adds nothing (no allocation, no membership
churn) when the inspector is off. runWithRequestScope adds a store on scope entry
and removes it when the handler settles; buildInFlightSnapshot reads it. Mirrors
the on-demand, opt-in shape of the log/socket tap slots.
*/
export const inFlightRequests: { tracked: Set<RequestStore> | undefined } = {
    tracked: undefined,
}
