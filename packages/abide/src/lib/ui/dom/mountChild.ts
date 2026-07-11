import { OWNER } from '../runtime/OWNER.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'
import { withOptionalPath } from '../runtime/withOptionalPath.ts'
import { mountRange } from './mountRange.ts'

/*
Mounts a child component as a marker-bounded range at `before` in `parent` — no
wrapper element, so the child's root is a true direct child of the parent (see
`mountRange`). Files the range's dispose with the mounting owner so its scope and DOM
leave together when the parent (or branch/row) tears down.
*/
// @documentation plumbing
export function mountChild(
    parent: Node,
    factory: UiComponent,
    props: Parameters<UiComponent>[1],
    before: Node | null = null,
    label?: string,
    /* The compiler's source-order ordinal for this `<Child/>` mount site — pushed onto the render
       path so the child's scope (and its cells) get a serialization-stable id under this parent
       (two same-type siblings differ by ordinal; the same site across `{#each}` rows differs by the
       row key the each block already pushed). Absent (a non-compiled caller) → no path segment. */
    ordinal?: number,
): void {
    const handle = withOptionalPath(ordinal, () =>
        mountRange(parent, factory.build, props, before, label),
    )
    OWNER.current?.push(handle.dispose)
}
