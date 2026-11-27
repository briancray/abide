// 32.11 — WHAT A `{...expr}` SPREADS, on both sides and in both positions.
//
// ON A COMPONENT, props: one accessor per key the value carries when the invocation is made, each
// re-reading the value, so a prop stays a live read (33.5) as an explicit one is. The keys are read
// once — a prop type with an index signature is where they are enumerated per read (33.11). Read
// before the value has landed, they throw `NotLanded` out of the record, and the invocation waits
// for it rather than the mount around it aborting (32.23, `invokeLanded` and `renderComponent`).
//
// ON AN ELEMENT, attributes: what the server writes into the tag, and what the client keeps writing.
// A key the element names explicitly is the explicit attribute's (33.12's rule, held for elements
// too); a value is written as a named attribute's is (32.37); a function or an `EventListenerObject`
// is a listener where the key is `on<event>`, and nothing under an `on<event>` key, nor any
// function, is ever markup.

import { attributeText, writtenMarkup } from './attributeText.ts'
import { BIND_ELEMENT } from './BIND_ELEMENT.ts'
import { isEventName } from './isEventName.ts'
import { abortedBy } from './slotValue.ts'

/** A `{...expr}` on a component, as one live prop accessor per key the value carries. */
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

/**
 * The attributes a spread value carries, as `[name, text]` — `''` for a bare one.
 *
 * The explicit names, the listeners and the unwritable are left out. One answer for the markup and
 * the binding.
 *
 * THE LISTENERS COME OUT OF THE SAME WALK, as `[event, listener]` pushed onto `listeners`: a
 * listener under `on<event>` that the element does not name explicitly. The server has nowhere to
 * put one and hands no array.
 *
 * A member a `NotLanded` aborted is pushed onto `held`, for the binding to leave as it last wrote it
 * (32.23); the server's markup leaves it out, as a slot aborted on a first render writes nothing.
 */
export function spreadEntries(
    value: unknown,
    explicit: readonly string[],
    listeners: [string, EventListener][] | null = null,
    held: string[] | null = null,
): [string, string][] {
    const entries: [string, string][] = []
    if (value === null || typeof value !== 'object') return entries
    for (const name of Object.keys(value)) {
        const lower = name.toLowerCase()
        if (explicit.includes(lower)) continue
        // 32.117 — A MEMBER IS A SLOT: a getter reading what has not landed aborts its own attribute,
        // as `slotValue` aborts an expression's, and never the spread's other members. The read
        // subscribed before it threw, so the binding's rerun is the landing. The try costs nothing
        // where nothing throws.
        let member: unknown
        try {
            member = (value as Record<string, unknown>)[name]
        } catch (thrown) {
            if (!abortedBy(thrown)) throw thrown
            held?.push(name)
            continue
        }
        // 32.4 — AN `on<event>` NAME IS NEVER MARKUP, whatever it holds: a string under `onclick`
        // written as an attribute is an inline handler, script compiled from data.
        if (isEventName(lower)) {
            if (listeners !== null && isListener(member))
                listeners.push([lower.slice(2), member as EventListener])
            continue
        }
        if (typeof member === 'function') continue
        // 32.99 — an element binding a headless component carries is bound at mount, never markup.
        if (lower === BIND_ELEMENT) continue
        if (!ATTRIBUTE_NAME.test(name)) continue
        // 32.37 — the named attribute's answer, so a spread and `name={expr}` never disagree.
        const text = attributeText(name, member)
        if (text !== null) entries.push([name, text])
    }
    return entries
}

/** 32.4, 32.95 — a function, or an `EventListenerObject`: what an `on<event>` takes as a listener. */
function isListener(member: unknown): boolean {
    return (
        typeof member === 'function' ||
        (member !== null &&
            typeof member === 'object' &&
            typeof (member as EventListenerObject).handleEvent === 'function')
    )
}

/**
 * 32.114 — the text a spread's `value` writes into a `<textarea>`, or `undefined` where it carries
 * none — or the element names `value` itself, and that is the text.
 */
export function spreadText(
    value: unknown,
    explicit: readonly string[],
): string | undefined {
    if (value === null || typeof value !== 'object') return undefined
    if (explicit.includes('value')) return undefined
    const text = attributeText('value', (value as { value?: unknown }).value)
    return text ?? undefined
}

/**
 * A spread's attributes as markup, each escaped.
 *
 * 32.11 on the server.
 */
export function spreadAttributes(
    value: unknown,
    explicit: readonly string[],
): string {
    let markup = ''
    for (const [name, text] of spreadEntries(value, explicit))
        markup += writtenMarkup(name, text)
    return markup
}
