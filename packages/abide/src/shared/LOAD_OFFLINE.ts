/**
 * The `offline` of the call that is starting a load, while it starts.
 *
 * 16.81 — SET AROUND THE REACH as `LOAD_SIGNAL` is, and read by the browser's wire as its body
 * starts: what stands in for an answer the call could not get. A leaf, because `callLoad` sets it
 * and the wire reads it.
 */
export const LOAD_OFFLINE: {
    current: ((args: unknown) => unknown) | undefined
    /**
     * Where the body that queues the call asks for the value the call reached, which `callLoad`
     * fills once the reach returns: what the delivered answer lands in (46.7).
     */
    standing: { value: unknown } | undefined
} = { current: undefined, standing: undefined }
