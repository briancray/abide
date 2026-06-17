import { hotInstances } from './hotInstances.ts'
import type { HotInstance } from './types/HotInstance.ts'

/*
Records a live component instance under its module id and returns a remove
callback. `mountChild` files the remove with the mounting owner, so the instance
leaves the registry when its parent (or branch/row) tears down — the module's set
is dropped once empty, leaving no orphan keys.
*/
export function registerHotInstance(moduleId: string, instance: HotInstance): () => void {
    let set = hotInstances.get(moduleId)
    if (set === undefined) {
        set = new Set()
        hotInstances.set(moduleId, set)
    }
    set.add(instance)
    return () => {
        set.delete(instance)
        if (set.size === 0) {
            hotInstances.delete(moduleId)
        }
    }
}
