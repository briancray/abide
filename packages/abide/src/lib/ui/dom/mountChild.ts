import { captureModelDoc } from '../runtime/captureModelDoc.ts'
import { hotReloadEnabled } from '../runtime/hotReloadEnabled.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { registerHotInstance } from '../runtime/registerHotInstance.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'
import { withPath } from '../runtime/withPath.ts'
import { mountRange } from './mountRange.ts'

/* Build-time flag the production client defines false (see build.ts `define`) so the hot
   path below — and its captureModelDoc/registerHotInstance imports — dead-code-eliminate
   (`!false` folds to a constant the minifier can prove) instead of shipping behind a runtime
   flag it can't. Dev defines it true; the test preload sets it on globalThis so the bare
   reference resolves to true there, leaving `hotReloadEnabled` alone in charge as before. */
declare const __ABIDE_DEV__: boolean

/*
Mounts a child component as a marker-bounded range at `before` in `parent` — no
wrapper element, so the child's root is a true direct child of the parent (see
`mountRange`). Plain path (production, and dev without the hot bridge): just run the
range mount with the component's own `build`. Hot path (hotReloadEnabled and the
factory carries a module id): keep the mount handle (its range markers + disposer)
and record the instance so an edit can re-fill the same range in place (see
`hotReplace`), and file a cleanup with the mounting owner so the record and its scope
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
    /* `ordinal === undefined` skips the push (path unchanged) for callers that pass no site id. */
    const build = <T>(run: () => T): T => (ordinal === undefined ? run() : withPath(ordinal, run))
    const moduleId = factory.__abideId
    if (!__ABIDE_DEV__ || !hotReloadEnabled.current || moduleId === undefined) {
        build(() => mountRange(parent, factory.build, props, before, label))
        return
    }
    /* Capture the component's model alongside its mount handle, so a later swap can
       carry its state across (see `hotReplace`). */
    const { value: handle, model } = build(() =>
        captureModelDoc(() => mountRange(parent, factory.build, props, before, label)),
    )
    const instance = {
        factory,
        props,
        label,
        start: handle.start,
        end: handle.end,
        dispose: handle.dispose,
        model,
    }
    const remove = registerHotInstance(moduleId, instance)
    OWNER.current?.push(() => {
        instance.dispose()
        remove()
    })
}
