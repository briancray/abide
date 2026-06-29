import { requestScopeResolver } from './requestScopeResolver.ts'

// Registers the runtime's request-scope resolver. Called once per side at boot.
export const setRequestScopeResolver = requestScopeResolver.set
