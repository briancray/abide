/*
Reserved topic-family prefix for the per-call amend value channel (ADR-0043). A
server-side `amend(args, value)` broadcasts on `${AMEND_TOPIC_PREFIX}${cacheKey}`, and
a client with a live reader of that exact call subscribes to the same topic — so a
pushed value only ever reaches a browser already reading (and therefore authorized
for) that key. Under the reserved `__abide/` namespace so user code can't shadow it,
and per-call (not per-rpc) so the subscription set doubles as the authorized-reader set.
*/
export const AMEND_TOPIC_PREFIX = '__abide/amend/'
