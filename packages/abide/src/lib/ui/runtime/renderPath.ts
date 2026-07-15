import { CURRENT_PATH } from './CURRENT_PATH.ts'
import { withPath } from './withPath.ts'

/*
The render-path a `<Child/>` mounts under — the boundary id of a STREAMED child component (ADR-0039).
Composes the child's ordinal segment onto the ambient path exactly as the client's dual-mode
`mountChild` does (`withPath(ordinal, …)`), so the server-written `abide:await:CHILDPATH`
boundary and the client adopter compute the SAME id with no counter to drift. It carries `/`
separators and never a `:`, so a child path (`products/0`) can't collide with an await-block id
(`products:0`). Server-emit-only (the streaming boundary is server codegen), so it tree-shakes out of
the client bundle like `$$flight`.
*/
// @documentation plumbing
export function renderPath(segment: string | number): string {
    return withPath(segment, () => CURRENT_PATH.current)
}
