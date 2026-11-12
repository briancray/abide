// 44 — THE PROVIDERS ABIDE SHIPS, the `Provider` an `assistant` call is handed: the Messages API
// (`claudeApi.ts`) and the visitor's own Claude Code with the pairing that reaches it
// (`claudeCode.ts`).

import { claudeApi } from './claudeApi.ts'
import { claudeCode } from './claudeCode.ts'

/** The providers abide ships. */
export const provider: {
    claudeApi: typeof claudeApi
    claudeCode: typeof claudeCode
} = { claudeApi, claudeCode }
