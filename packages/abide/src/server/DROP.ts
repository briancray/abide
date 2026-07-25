// DROP — the sentinel a `clientPublish` mediator returns to suppress an untrusted client publish
// (ADR 0023 §composition). It belongs to the SOCKET layer, not the pub/sub core: a bare `channel` has
// no mediator, so the `ChannelHub` it runs on never sees this symbol.
//
// Returning `DROP` (or nothing at all) from the mediator drops the message; returning a value publishes
// that transformed value.

export const DROP: unique symbol = Symbol('abide.socket.drop')
