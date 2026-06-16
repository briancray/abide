import type { RequestScopeInfo } from './types/RequestScopeInfo.ts'

/*
Internal slot the runtime entries register their request-scope resolver into.
The server installs an ALS-backed resolver (createServer, reading the
RequestStore); the client installs a module-singleton resolver seeded from
__SSR__ (startClient). Undefined resolver — or a resolver returning undefined
outside any request — means "no scope": trace() returns undefined and log
lines print without the context prefix. Mirrors pageSlot / cacheStoreSlot.
*/
export const requestScopeSlot: {
    resolver: (() => RequestScopeInfo | undefined) | undefined
} = {
    resolver: undefined,
}
