// ONE IMMUTABLE SNAPSHOT of a memo slot's observable read — and the two operations over it that decide
// whether anybody wakes.
//
// Its own module because BOTH fill paths hold it (`CONTEXT.md`, "Fill mode"): the loading path keeps it
// in `slot.state`, and the auto-tracked derivation keeps it inside a backing `computed`. Anything that
// has to answer "what does this slot read as" therefore needs this type, and it used to be private to
// `memo.ts` — which is what kept the derivation backing from being a module at all.

import type { ReplayableStream } from './replayableStream.ts'

// The four states a slot's read can be in. `stream` is the fan-out case (§4).
export type Status = 'idle' | 'pending' | 'value' | 'error' | 'stream'

// NEVER MUTATED IN PLACE — which is what lets `setState` hand the SAME object back when a transition is
// observably a no-op, so the state's `===` comparison does not fire and no reader wakes. Replacing it
// with a fresh object on every transition is the bug, not the contract: identity is the propagation
// cutoff.
export interface SlotState<T> {
    status: Status
    value: T | undefined
    error: unknown
    // Set only when status === "stream": the shared replay buffer this slot fans out (§4).
    stream?: ReplayableStream<unknown>
}

export function idleState<T>(): SlotState<T> {
    return { status: 'idle', value: undefined, error: undefined }
}

// Do two slot states describe the same observable read? Used to keep a derived value's identity STABLE
// across a re-run that produced the same result, which is what lets the reactive graph cut propagation
// (see `merged`). `value` is compared by IDENTITY, exactly like every other derived primitive: a body
// that hands back a fresh object each run genuinely may have changed, and guessing otherwise would drop
// real updates. `SlotState` is always replaced, never mutated in place, so sharing one is safe.
export function sameSlotState<T>(a: SlotState<T>, b: SlotState<T>): boolean {
    return (
        a.status === b.status && a.value === b.value && a.error === b.error && a.stream === b.stream
    )
}
