// THE CALL STARTING A LOAD, while it starts (16.49, 16.81, 46.7). `callLoad` opens it around the
// synchronous reach and closes it after, and a transport's body — the browser's wire — reads it as
// it starts: the core runs a body's first step inside the reach, so the call is still open there
// and closed by the time anything the body awaits comes back.
//
// THE ORDER IS THE INTERFACE. A body asks once, with `startingLoadCall`, and is handed what the call
// carried rather than the live record, so a read made after an await cannot see a closed call — it
// holds what it was handed. The writer's three verbs are the only way the record moves.
//
// A module of its own because `callLoad` (shared) opens it and the wire (ui) reads it.

const STARTING: {
    signal: AbortSignal | undefined
    offline: ((args: unknown) => unknown) | undefined
    /**
     * Where the body that queues the call asks for the value the call reached, filled once the reach
     * returns: what the delivered answer lands in (46.7).
     */
    standing: { value: unknown } | undefined
} = { signal: undefined, offline: undefined, standing: undefined }

/**
 * Opens the call starting a load: the load's own abort `signal` (16.49) and the call's `offline`
 * (16.81), for the body the reach runs.
 */
export function beginLoadCall(
    signal: AbortSignal | undefined,
    offline: ((args: unknown) => unknown) | undefined,
): void {
    STARTING.signal = signal
    STARTING.offline = offline
}

/** Hands what the reach returned to a body that queued the call (46.7), where one asked. */
export function reachedInLoadCall(reached: unknown): void {
    const standing = STARTING.standing
    if (standing !== undefined) standing.value = reached
}

/** Closes the call: a body started after this reads no signal, no `offline` and no stand. */
export function endLoadCall(): void {
    STARTING.signal = undefined
    STARTING.offline = undefined
    STARTING.standing = undefined
}

/**
 * What the call starting this load carries, read by the body before anything awaits — both
 * `undefined` for a load no call started (a refresh, a reload).
 */
export function startingLoadCall(): {
    signal: AbortSignal | undefined
    offline: ((args: unknown) => unknown) | undefined
} {
    return { signal: STARTING.signal, offline: STARTING.offline }
}

/**
 * Where the value the call reaches will land, for a body that queues the call (46.7) — filled by
 * `reachedInLoadCall` once the reach returns.
 */
export function standForLoadCall(): { value: unknown } {
    const standing = { value: undefined }
    STARTING.standing = standing
    return standing
}
