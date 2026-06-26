import type { HttpMethod } from './types/HttpMethod.ts'

/*
Read-only (safe) HTTP methods — they don't mutate server state. Abide
uses this to decide which verbs auto-expose to MCP: reads flip MCP on
when a schema is present, mutations require an explicit `clients.mcp`
opt-in so a model can't delete/overwrite data just because the handler
carries a schema. Also feeds the MCP tool `readOnlyHint` annotation.
*/
const READ_ONLY_METHODS = new Set<HttpMethod>(['GET', 'HEAD'])

export function isReadOnlyMethod(method: HttpMethod): boolean {
    return READ_ONLY_METHODS.has(method)
}
