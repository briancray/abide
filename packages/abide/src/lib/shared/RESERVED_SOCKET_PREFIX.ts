/*
The reserved socket-name namespace (ADR-0041). Framework-minted internal topics
live under `__abide/` (e.g. the cache-staleness pipe); user socket files under
`src/server/sockets` may not declare a name in this namespace — createServer rejects
the boot, and the dispatcher resolves these names straight from the registry
(bypassing the user-module loader) so an internal topic can never be shadowed.
*/
export const RESERVED_SOCKET_PREFIX = '__abide/'
