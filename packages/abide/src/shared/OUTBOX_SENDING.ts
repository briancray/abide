/**
 * Whether the outbox has a call in flight, as a bare `busy` asks it (46.11).
 *
 * A leaf, because `outbox` fills it and the core's `busy` reads it from below `outbox`. Unfilled — an
 * app holding no handler — no call is ever in flight.
 */
export const OUTBOX_SENDING: { any: (() => boolean) | undefined } = {
    any: undefined,
}
