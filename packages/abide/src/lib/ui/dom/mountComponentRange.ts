import { captureModelDoc } from '../runtime/captureModelDoc.ts'
import { hotReloadEnabled } from '../runtime/hotReloadEnabled.ts'
import { registerHotInstance } from '../runtime/registerHotInstance.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'
import { mountRange } from './mountRange.ts'

/* Build-time flag the production client defines false (see build.ts `define`) so the hot path
   below — and its captureModelDoc/registerHotInstance imports — dead-code-eliminate instead of
   shipping behind a runtime flag the minifier can't prove. Dev defines it true; the test preload
   sets it on globalThis so the bare reference resolves to true there. */
declare const __ABIDE_DEV__: boolean

/*
Mounts a component as a marker-bounded range at `before` in `parent`, and — in dev with the hot
bridge live and the factory carrying a module id — records the instance so an edit re-fills the same
range in place (see `hotReplace`). Returns the mount handle whose `dispose` also unregisters the hot
record. Shared by `mountChild` and `mountStreamedChild` so a hoistable (streamed) child keeps the
exact in-place HMR an inline child gets, instead of falling back to a full page reload.
*/
export function mountComponentRange(
    parent: Node,
    factory: UiComponent,
    props: Parameters<UiComponent>[1],
    before: Node | null = null,
    label?: string,
): { dispose: () => void } {
    const moduleId = factory.__abideId
    if (!__ABIDE_DEV__ || !hotReloadEnabled.current || moduleId === undefined) {
        return mountRange(parent, factory.build, props, before, label)
    }
    /* Capture the component's model alongside its mount handle, so a later swap can carry its
       state across (see `hotReplace`). */
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
    return {
        dispose: () => {
            instance.dispose()
            remove()
        },
    }
}
