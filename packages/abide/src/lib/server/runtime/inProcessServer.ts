import type { Server } from 'bun'

/*
The Server `server()` hands back under in-process dispatch (CLI / MCP / test
client), where no Bun.serve has booted so there is no live connection to act on.
Each member is the honest no-op for a request that never rode a socket: timeout
and upgrade do nothing, publish reaches no subscribers (0 bytes sent),
subscriberCount is 0, requestIP has no peer (null). Handlers using these idioms
run unchanged in-process instead of throwing; createServer's live Server takes
precedence whenever one is booted. Connection-scoped only — config-shaped
members (port, url, hostname …) are intentionally absent: there is no server to
describe, and a stubbed value would mislead more than their plain absence.
*/
export const inProcessServer = {
    timeout() {},
    upgrade: () => false,
    publish: () => 0,
    subscriberCount: () => 0,
    requestIP: () => null,
} as unknown as Server<unknown>
