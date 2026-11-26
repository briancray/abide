/**
 * Where a call's answer — the promise or the stream an `Rpc` call hands back (16.3) — keeps the
 * handler's value for the args it was called with, so a derived `reactive` handing that answer back whole
 * adopts the value (11.12) rather than settling it to one snapshot.
 */
export const CALL_ENTRY: unique symbol = Symbol('abide.callEntry')
