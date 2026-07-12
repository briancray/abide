/*
The reserved internal socket the server broadcasts cache-staleness frames on
(ADR-0041): server-publish-only (`clientPublish: false`) and a pure live pipe
(`tail: 0`, no retention) — delivery is live-only, never replayed, so an offline
client falls back to SWR staleness. Named in the reserved `__abide/` namespace so
user code can't shadow it.
*/
export const CACHE_STALENESS_SOCKET = '__abide/cache'
