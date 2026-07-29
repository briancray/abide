// The framework route that answers "is this deployment up, and what does its own `onHealth` say?" —
// the transport half of the isomorphic `health()`.
//
// Named once for the same reason `IDENTITY_ROUTE` is: several surfaces reach for it from both sides.
// The browser half of `health()` fetches it, the compiled binary's `logs` command PREFLIGHTS it (a tail
// is expected to sit there producing nothing, so a wrong host and a quiet app would otherwise be one
// empty screen), the test app exposes it, and the router serves it.
export const HEALTH_ROUTE = '/__abide/health'
