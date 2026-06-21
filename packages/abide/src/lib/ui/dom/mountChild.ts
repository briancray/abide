import { captureModelDoc } from '../runtime/captureModelDoc.ts'
import { hotReloadEnabled } from '../runtime/hotReloadEnabled.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { registerHotInstance } from '../runtime/registerHotInstance.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'
import { mountRange } from './mountRange.ts'

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
): void {
    const moduleId = factory.__abideId
    if (!hotReloadEnabled.current || moduleId === undefined) {
        mountRange(parent, factory.build, props, before, label)
        return
    }
    /* Capture the component's model alongside its mount handle, so a later swap can
       carry its state across (see `hotReplace`). */
    const { value: handle, model } = captureModelDoc(() =>
        mountRange(parent, factory.build, props, before, label),
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
