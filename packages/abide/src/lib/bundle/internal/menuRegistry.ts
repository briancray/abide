// MENU EVENT REGISTRY (BU4) — the sink behind `onMenu` and the native `emit` items.
//
// A native menu `emit` item fires a named event. `onMenu(name, handler)` subscribes to one name;
// `onMenu(handler)` subscribes to every emit. This module holds both registries and the dispatch
// used by `emitMenu(name)` (which the launcher / native shell calls when a menu item is chosen).
//
// Kept a plain Map/Set registry — no reactivity — because menu emits are one-shot side effects, not
// reactive state. Handlers fire in registration order; a throwing handler is isolated so one bad
// listener can't swallow the rest.

export type MenuHandler = () => void

// name -> handlers listening for that specific emit.
const NAMED: Map<string, Set<MenuHandler>> = new Map()

// handlers listening for ALL emits (the onMenu(handler) overload).
const ALL: Set<MenuHandler> = new Set()

// Register a handler for one menu-emit name. Returns an unsubscribe.
export function registerNamed(name: string, handler: MenuHandler): () => void {
    let handlers = NAMED.get(name)
    if (handlers === undefined) {
        handlers = new Set()
        NAMED.set(name, handlers)
    }
    handlers.add(handler)
    return () => {
        const set = NAMED.get(name)
        if (set === undefined) return
        set.delete(handler)
        if (set.size === 0) NAMED.delete(name)
    }
}

// Register a handler for every menu emit. Returns an unsubscribe.
export function registerAll(handler: MenuHandler): () => void {
    ALL.add(handler)
    return () => {
        ALL.delete(handler)
    }
}

// Fire every handler subscribed to `name`, then every all-emits handler. A throwing handler is
// caught and reported so the rest still run.
export function dispatchMenu(name: string): void {
    const named = NAMED.get(name)
    if (named !== undefined) {
        for (const handler of named) runIsolated(handler)
    }
    for (const handler of ALL) runIsolated(handler)
}

function runIsolated(handler: MenuHandler): void {
    try {
        handler()
    } catch (caught) {
        console.error(
            '[abide:bundle] onMenu handler threw:',
            caught instanceof Error ? caught.message : String(caught),
        )
    }
}
