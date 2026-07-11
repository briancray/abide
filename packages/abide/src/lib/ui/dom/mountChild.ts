import { hotReloadEnabled } from '../runtime/hotReloadEnabled.ts'
import { OWNER } from '../runtime/OWNER.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'
import { withOptionalPath } from '../runtime/withOptionalPath.ts'
import { mountComponentRange } from './mountComponentRange.ts'
import { mountRange } from './mountRange.ts'

/* Build-time flag the production client defines false (see build.ts `define`) so the hot
   path below dead-code-eliminates (`!false` folds to a constant the minifier can prove) instead
   of shipping behind a runtime flag it can't. Dev defines it true; the test preload sets it on
   globalThis so the bare reference resolves to true there, leaving `hotReloadEnabled` alone in
   charge as before. */
declare const __ABIDE_DEV__: boolean

/*
Mounts a child component as a marker-bounded range at `before` in `parent` — no
wrapper element, so the child's root is a true direct child of the parent (see
`mountRange`). Plain path (production, and dev without the hot bridge): just run the
range mount with the component's own `build`. Hot path (hotReloadEnabled and the
factory carries a module id): `mountComponentRange` keeps the mount handle and records
the instance so an edit can re-fill the same range in place (see `hotReplace`), and we
file its dispose with the mounting owner so the record and its scope leave together when
the parent (or branch/row) tears down.
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
    const moduleId = factory.__abideId
    if (!__ABIDE_DEV__ || !hotReloadEnabled.current || moduleId === undefined) {
        withOptionalPath(ordinal, () => mountRange(parent, factory.build, props, before, label))
        return
    }
    const handle = withOptionalPath(ordinal, () =>
        mountComponentRange(parent, factory, props, before, label),
    )
    OWNER.current?.push(handle.dispose)
}
