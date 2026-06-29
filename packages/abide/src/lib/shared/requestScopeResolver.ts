import { createResolverSlot } from './createResolverSlot.ts'
import type { RequestScopeInfo } from './types/RequestScopeInfo.ts'

/*
Slot + setter for the request-scope resolver. The server installs an ALS-backed
resolver (createServer, reading the RequestStore); the client a module-singleton
seeded from __SSR__ (startClient). No fallback creator — an unset resolver (or one
returning undefined outside any request) means "no scope": callers read
`.resolver?.()` and treat undefined as absent. requestScopeSlot /
setRequestScopeResolver re-export the slot and setter.
*/
export const requestScopeResolver = createResolverSlot<RequestScopeInfo>()
