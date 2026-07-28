// The framework route that answers "who does the server think this caller is?" — the transport half of
// the isomorphic `identity()`.
//
// Named once because three surfaces reach for it: the browser's `identity.refresh()`, a compiled
// binary's `identity` subcommand, and the router that serves it. It sits under `/__abide/` with the
// other generated routes, and returns the caller's OWN principal — the same thing their next request
// would be treated as, which is why it discloses nothing they do not already hold.
export const IDENTITY_ROUTE = '/__abide/identity'
