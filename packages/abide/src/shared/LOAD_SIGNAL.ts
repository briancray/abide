// 16.54 — THE SIGNAL OF THE CALL THAT IS STARTING A LOAD, set around the reach and read by a
// transport's body as it starts: the browser's wire hands it to `fetch`, so a load every caller
// aborted ends its request too. A leaf, because `rpc` sets it and the wire reads it.
export const LOAD_SIGNAL: { current: AbortSignal | undefined } = {
    current: undefined,
}
