import { hotInstances } from './hotInstances.ts'
import type { UiComponent } from './types/UiComponent.ts'

/*
Swaps every live instance of an edited component to its new factory. Per instance:
dispose the current scope and its DOM (the mount disposer clears the host), then
re-run `next` into the same host with the same props — so state above the boundary
survives (props are thunks that re-read the parent's live signals) while the
component's own state resets. The hot module calls this on load with its freshly
compiled `next`. Returns whether it swapped at least one instance: false (the edited
component has none mounted — e.g. a router-mounted page, or a hidden branch) tells
the caller to fall back to a full reload, since nothing on screen would update.
*/
export function hotReplace(moduleId: string, next: UiComponent): boolean {
    const set = hotInstances.get(moduleId)
    if (set === undefined || set.size === 0) {
        return false
    }
    for (const instance of set) {
        instance.dispose()
        instance.factory = next
        instance.dispose = next(instance.host, instance.props)
    }
    return true
}
