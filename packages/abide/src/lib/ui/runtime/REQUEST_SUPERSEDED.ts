/*
The abort reason used to cancel an RPC bound to a reactive computation when that
computation re-runs (its result is superseded) or its scope disposes. A unique
symbol so remoteProxy can distinguish OUR cancellation — which it swallows into a
never-settling promise, never a rejection — from a genuine network fault or a
caller's own abort.
*/
export const REQUEST_SUPERSEDED: unique symbol = Symbol('abide.request.superseded')
