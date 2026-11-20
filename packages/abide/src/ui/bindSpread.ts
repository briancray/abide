// 32.11 — AN ELEMENT'S SPREAD, KEPT WRITTEN. The server wrote what the value carried at render; a
// watch keeps writing it, removing an attribute the value no longer carries, and an `on<event>`
// listener becomes the element's, with its options (32.4), replaced when the value hands over another.

import { spreadEntries } from '#shared/spread.ts'

import { listen, unlisten } from './listen.ts'
import type { Scope } from './Scope.ts'
import { writeAttribute } from './setAttribute.ts'

/** Keeps an element's spread attributes and `on<event>` listeners written as the value changes. */
export function bindSpread(
    element: Element,
    read: () => unknown,
    explicit: readonly string[],
    scope: Scope,
): void {
    let written = new Set<string>()
    const listeners = new Map<string, EventListener>()
    scope.watch(() => {
        const wanted: [string, EventListener][] = []
        const next = new Set<string>()
        for (const [name, text] of spreadEntries(read(), explicit, wanted)) {
            next.add(name)
            writeAttribute(element, name, text)
        }
        for (const name of written)
            if (!next.has(name)) element.removeAttribute(name)
        written = next
        const seen = new Set<string>()
        for (const [event, listener] of wanted) {
            seen.add(event)
            const standing = listeners.get(event)
            if (standing === listener) continue
            if (standing !== undefined) unlisten(element, event, standing)
            listen(element, event, listener)
            listeners.set(event, listener)
        }
        for (const [event, listener] of listeners)
            if (!seen.has(event)) {
                unlisten(element, event, listener)
                listeners.delete(event)
            }
    })
}
