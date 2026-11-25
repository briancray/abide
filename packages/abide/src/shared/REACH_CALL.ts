/**
 * The member an `Rpc` reaches the handler's value for some args through — what a call answered
 * before 16.3 made it answer as the handler's body does. Abide's own callers that hold the value
 * itself — the wire's follow, the outbox, a form — reach it here; an app never does.
 */
export const REACH_CALL = Symbol('abide.reachCall')
