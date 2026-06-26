import type { HttpMethod } from '../shared/types/HttpMethod.ts'

/*
Maps an HTTP method to MCP tool annotations so a model can tell a read from
a write before calling. Abide derives these from the rpc the RPC was
declared with rather than asking the author to repeat the intent:
  - GET / HEAD  → read-only, non-destructive
  - POST        → creates; not idempotent, not (necessarily) destructive
  - PUT         → replaces; idempotent + destructive
  - PATCH       → modifies; destructive, not idempotent
  - DELETE      → removes; idempotent + destructive
The shape matches MCP's ToolAnnotations (readOnlyHint / destructiveHint /
idempotentHint); fields a rpc doesn't imply are left off.
*/
export function annotationsForMethod(method: HttpMethod): Record<string, boolean> {
    switch (method) {
        case 'GET':
        case 'HEAD':
            return { readOnlyHint: true, destructiveHint: false }
        case 'POST':
            return { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
        case 'PUT':
            return { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
        case 'PATCH':
            return { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
        case 'DELETE':
            return { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    }
}
