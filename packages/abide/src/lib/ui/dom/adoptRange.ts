import { scope } from '../runtime/scope.ts'
import type { UiProps } from '../runtime/types/UiProps.ts'
import { disposeRange } from './disposeRange.ts'
import { openMarker } from './openMarker.ts'
import { withScope } from './withScope.ts'

/*
Adopts a component's server range IN PLACE during hydration, given its already-claimed
`start` marker and the `closeData` of the marker that ends the range. Establishes the
child's lexical scope + render pass (`withScope`), builds claiming the existing nodes,
then claims the end marker the build's content stops before — the hydrate half of
`mountRange`, factored out so `mountChild`'s ADDRESSED adopt (`abide:c:PATH` brackets,
ADR-0049) and `mountRange`'s anonymous `[`/`]` adopt share ONE implementation and can't
drift. A build throw is leak-safe: `withScope`/`scope` dispose the partial scope before
rethrowing, so the caller's `discardAndRebuild` recovery starts clean.
*/
export function adoptRange(
    parent: Node,
    build: (host: Node, props?: UiProps) => void,
    props: UiProps | undefined,
    start: Comment,
    closeData: string,
): { start: Comment; end: Comment; dispose: () => void } {
    const scoped = withScope(() => scope(() => build(parent, props)))
    const end = openMarker(parent, closeData)
    return { start, end, dispose: disposeRange(scoped, start, end) }
}
