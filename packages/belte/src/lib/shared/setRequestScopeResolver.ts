import { requestScopeSlot } from './requestScopeSlot.ts'
import type { RequestScopeInfo } from './types/RequestScopeInfo.ts'

export function setRequestScopeResolver(fn: () => RequestScopeInfo | undefined): void {
    requestScopeSlot.resolver = fn
}
