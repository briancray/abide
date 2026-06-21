import { fillRange } from '../dom/fillRange.ts'
import { captureModelDoc } from './captureModelDoc.ts'
import { hotInstances } from './hotInstances.ts'
import { seedModelDoc } from './seedModelDoc.ts'
import type { UiComponent } from './types/UiComponent.ts'

/*
Swaps every live instance of an edited component to its new factory. Per instance:
snapshot its model, dispose the current scope and clear its DOM range (the disposer
leaves the `start`/`end` markers in place), re-fill the SAME range with the new
module's `build` and the same props, then re-seed the fresh model from the snapshot —
so the user's in-progress `state` survives the edit (state above the boundary already
survives: props are thunks re-reading the parent's live signals). The hot module
calls this on load with its freshly compiled `next`. Returns whether it swapped at
least one instance: false (the edited component has none mounted — e.g. a
router-mounted page, or a hidden branch) tells the caller to fall back to a full
reload, since nothing on screen would update.
*/
export function hotReplace(moduleId: string, next: UiComponent): boolean {
    const set = hotInstances.get(moduleId)
    if (set === undefined || set.size === 0) {
        return false
    }
    for (const instance of set) {
        const saved = instance.model?.snapshot()
        instance.dispose()
        instance.factory = next
        const { value: handle, model } = captureModelDoc(() =>
            fillRange(instance.start, instance.end, next.build, instance.props, instance.label),
        )
        instance.dispose = handle.dispose
        instance.model = model
        if (saved !== undefined && model !== undefined) {
            seedModelDoc(model, saved)
        }
    }
    return true
}
