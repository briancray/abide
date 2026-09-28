// 32.11 — WHAT A `{...expr}` SPREADS, on both sides and in both positions.
//
// ON A COMPONENT, props: one accessor per key the value carries when the invocation is made, each
// re-reading the value, so a prop stays a live read (33.5) as an explicit one is. The keys are read
// once — a prop type with an index signature is where they are enumerated per read (33.11).
//
// ON AN ELEMENT, attributes: what the server writes into the tag, and what the client keeps writing.
// A key the element names explicitly is the explicit attribute's (33.12's rule, held for elements
// too); a value is written as a named attribute's is (32.38); a function is a listener where the
// key is `on<event>`, and nothing under an `on<event>` key, nor any function, is ever markup.

import { attributeText, writtenMarkup } from './attributeText.ts'
import { isEventName } from './isEventName.ts'

export function spreadProps(
    read: () => unknown,
): Record<string, () => unknown> {
    const value = read()
    const props: Record<string, () => unknown> = {}
    if (value === null || typeof value !== 'object') return props
    for (const key of Object.keys(value))
        props[key] = () => (read() as Record<string, unknown> | null)?.[key]
    return props
}

// An attribute name the markup can carry: anything but space, quotes, `>`, `/` and `=`.
const ATTRIBUTE_NAME = /^[^\s"'>/=]+$/

// The attributes a spread value carries, as `[name, text]` — `''` for a bare one — with the explicit
// names, the listeners and the unwritable left out. One answer for the markup and the binding.
//
// THE LISTENERS COME OUT OF THE SAME WALK, as `[event, listener]` pushed onto `listeners`: a
// function under `on<event>` that the element does not name explicitly. The server has nowhere to
// put one and hands no array.
export function spreadEntries(
    value: unknown,
    explicit: readonly string[],
    listeners: [string, EventListener][] | null = null,
): [string, string][] {
    const entries: [string, string][] = []
    if (value === null || typeof value !== 'object') return entries
    for (const [name, member] of Object.entries(value)) {
        const lower = name.toLowerCase()
        if (explicit.includes(lower)) continue
        // 32.4 — AN `on<event>` NAME IS NEVER MARKUP, whatever it holds: a string under `onclick`
        // written as an attribute is an inline handler, script compiled from data.
        if (isEventName(lower)) {
            if (listeners !== null && typeof member === 'function')
                listeners.push([lower.slice(2), member as EventListener])
            continue
        }
        if (typeof member === 'function') continue
        if (!ATTRIBUTE_NAME.test(name)) continue
        // 32.38 — the named attribute's answer, so a spread and `name={expr}` never disagree.
        const text = attributeText(name, member)
        if (text !== null) entries.push([name, text])
    }
    return entries
}

// 32.11 on the server: the spread's attributes as markup, each escaped.
export function spreadAttributes(
    value: unknown,
    explicit: readonly string[],
): string {
    let markup = ''
    for (const [name, text] of spreadEntries(value, explicit))
        markup += writtenMarkup(name, text)
    return markup
}
