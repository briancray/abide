// 32.11 — AN ELEMENT'S SPREAD, KEPT WRITTEN. The server wrote what the value carried at render; a
// watch keeps writing it, removing an attribute the value no longer carries, and an `on<event>`
// listener becomes the element's, with its options (32.4), replaced when the value hands over another.
// 32.113 — on a form control, a `value`, `checked` or `selected` it carries is written into the
// property too; whether the element is one is asked once, so a spread on anything else pays nothing.

import { BIND_ELEMENT } from '#shared/BIND_ELEMENT.ts'
import { isControlProperty } from '#shared/isControlProperty.ts'
import type { Disposer } from '#shared/reactive/watch.ts'
import { spreadEntries } from '#shared/spread.ts'

import { bindElement } from './bindElement.ts'
import { listen, unlisten } from './listen.ts'
import type { Scope } from './Scope.ts'
import { writeAttribute, writeControl } from './setAttribute.ts'

/** Keeps an element's spread attributes and `on<event>` listeners written as the value changes. */
export function bindSpread(
    element: Element,
    read: () => unknown,
    explicit: readonly string[],
    scope: Scope,
): void {
    let written = new Set<string>()
    const listeners = new Map<string, EventListener>()
    const tag = element.localName
    const control = tag === 'input' || tag === 'textarea' || tag === 'option'
    scope.watch(() => {
        const wanted: [string, EventListener][] = []
        const next = new Set<string>()
        for (const [name, text] of spreadEntries(read(), explicit, wanted)) {
            next.add(name)
            writeAttribute(element, name, text)
            if (control) controlProperty(element, tag, name, text)
        }
        for (const name of written)
            if (!next.has(name)) {
                element.removeAttribute(name)
                if (control) controlProperty(element, tag, name, null)
            }
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

function controlProperty(
    element: Element,
    tag: string,
    name: string,
    text: string | null,
): void {
    const lower = name.toLowerCase()
    if (isControlProperty(tag, lower)) writeControl(element, lower, text)
}

/**
 * 32.99 — A SPREAD'S ELEMENT BINDING, handed the element as `bind:element` hands it: at the region's
 * mount, once the element is connected (32.68), bound again only when the value carries another, and
 * its `Disposer` run when it is replaced or the region is torn down. What lets a headless component carry
 * behavior an attribute cannot — a property to set, a popover to place — inside the one spread.
 *
 * A SPREAD CARRYING NONE AT MOUNT PAYS NOTHING: no watch is made for it. A parts value's shape is
 * fixed when it is made, so one that carries no binding at mount never comes to, and a spread in a
 * row of a long list costs no watch per row for a binding it does not have.
 */
export function bindSpreadElement(
    element: Element,
    read: () => unknown,
    scope: Scope,
): void {
    if (memberOf(read()) === undefined) return
    let bound: unknown
    let disposer: Disposer | undefined
    scope.watch(() => {
        const next = memberOf(read())
        if (next === bound) return
        disposer?.()
        bound = next
        disposer = next === undefined ? undefined : bindElement(element, next)
    })
    scope.stops.push(() => disposer?.())
}

function memberOf(value: unknown): unknown {
    return value !== null && typeof value === 'object'
        ? (value as Record<string, unknown>)[BIND_ELEMENT]
        : undefined
}
