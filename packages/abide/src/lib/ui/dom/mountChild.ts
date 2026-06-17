import { hotReloadEnabled } from '../runtime/hotReloadEnabled.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { registerHotInstance } from '../runtime/registerHotInstance.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'

/*
Mounts a child component into its wrapper host. Plain path (production, and dev
without the hot bridge): run the factory — exactly the bare call the compiler used
to emit. Hot path (hotReloadEnabled and the factory carries a module id): keep the
mount disposer and record the instance so an edit can dispose + re-run it in place,
and file a cleanup with the mounting owner so the record and its scope leave
together when the parent (or branch/row) tears down. The factory already mounts
under its own scope (see `mount`), so the recorded disposer tears down just this
instance.
*/
// @readme plumbing
export function mountChild(
    host: Element,
    factory: UiComponent,
    props: Parameters<UiComponent>[1],
): void {
    const moduleId = factory.__abideId
    if (!hotReloadEnabled.current || moduleId === undefined) {
        factory(host, props)
        return
    }
    const instance = { host, factory, props, dispose: factory(host, props) }
    const remove = registerHotInstance(moduleId, instance)
    OWNER.current?.push(() => {
        instance.dispose()
        remove()
    })
}
