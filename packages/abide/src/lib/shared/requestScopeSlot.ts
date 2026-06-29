import { requestScopeResolver } from './requestScopeResolver.ts'

/*
Internal slot the runtime entries register their request-scope resolver into (see
requestScopeResolver). Exposed so callers read `.resolver?.()` and test helpers
snapshot/poke `.resolver` directly. Undefined resolver — or one returning
undefined outside any request — means "no scope": trace() returns undefined and
log lines print without the context prefix.
*/
export const requestScopeSlot = requestScopeResolver.slot
