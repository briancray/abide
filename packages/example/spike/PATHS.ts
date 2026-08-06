// Every path abide serves is under one reserved prefix, and every path an app serves is not.
//
// One prefix rather than a convention per feature: an app author needs exactly one rule to know what
// is theirs, and an operator needs exactly one pattern to proxy, cache-bust, CSP or exclude. `__` is
// the ordinary "not yours" signal and it cannot collide with a route segment anyone would write.
//
// The KIND is in the path even though the id below is already unique, because the two are dispatched
// differently — a socket is a websocket upgrade, not a POST — and because a network panel showing
// `/__abide/rpc/users/getUser` says what happened without anyone having to decode it.

export const ABIDE_PREFIX = '/__abide/'
export const RPC_PREFIX = `${ABIDE_PREFIX}rpc/`
export const SOCKET_PREFIX = `${ABIDE_PREFIX}socket/`
