import { CURRENT_PATH } from './CURRENT_PATH.ts'
import { withPathFrom } from './withPathFrom.ts'

/*
Pushes one render-path segment for the duration of `build`, RELATIVE to the live ambient path,
restoring after (synchronous build, so the save/restore is exact and nesting is a strict stack —
the same shape `withScope`/`enterRenderPass` use). The segment is `escapeKey`-escaped and joined
with `/`, so a segment carrying a `/` (a URL-shaped `{#each}` key) survives as one element. Used
at sites that run DURING the initial render walk (a layout layer, a `<Child/>` mount) where the
ambient path is the correct base. A control-flow block that rebuilds reactively after mount uses
`withPathFrom` with a captured base instead.
*/
// @documentation plumbing
export function withPath<T>(segment: string | number, build: () => T): T {
    return withPathFrom(CURRENT_PATH.current, segment, build)
}
