// 32.4, 32.95 — AN `on<event>` VALUE IS A LISTENER AND ITS OPTIONS AT ONCE. Handed as the third argument
// too, an `EventListenerObject`'s `capture`, `once`, `passive` and `signal` are what
// `addEventListener` reads them as, and a function carries none of them, so it is added as a function
// alone would be. One call for both shapes, and the same one removes it.
//
// 39.23 — WITH A SCOPE, IT LEAVES WITH IT: a `<window>` or a `<document>` outlives the component that
// listened on it, so the listener is removed when that component's scope stops. An element's is not,
// because the element leaves with the component.

import type { Scope } from './Scope.ts'

/** Adds an `on<event>` value as `target`'s listener, removed when `scope` stops where one is given. */
export function listen(
    target: EventTarget,
    type: string,
    listener: unknown,
    scope?: Scope,
): void {
    // `onclick={open && show}` — a value that is no listener adds none.
    if (!listener) return
    const added = listener as EventListenerObject
    target.addEventListener(type, added, added as AddEventListenerOptions)
    if (scope !== undefined)
        scope.stops.push(() =>
            target.removeEventListener(
                type,
                added,
                added as EventListenerOptions,
            ),
        )
}
