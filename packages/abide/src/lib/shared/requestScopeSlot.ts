import { createResolverSlot } from './createResolverSlot.ts'
import type { RequestScopeInfo } from './types/RequestScopeInfo.ts'

/*
The request-scope slot. The server installs an ALS-backed resolver
(createServer, reading the RequestStore); the client a module-singleton seeded
from __SSR__ (startClient). No fallback creator — an unset resolver (or one
returning undefined outside any request) means "no scope": callers read
`.resolver?.()` and treat undefined as absent (trace() returns undefined and
log lines print without the context prefix). Test helpers snapshot/poke
`.resolver` directly.
*/
export const requestScopeSlot = createResolverSlot<RequestScopeInfo>()
