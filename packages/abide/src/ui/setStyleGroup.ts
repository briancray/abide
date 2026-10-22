import { oneStyleValue } from '#shared/escapeText.ts'
import { textOf } from '#shared/Raw.ts'
import { WORK } from '#shared/WORK.ts'

/**
 * 32.71 — what a `style={expr}` and the `style:prop` directives beside it last wrote, as one
 * group: the attribute's text, its declarations once they have been needed, and the directives'
 * values in the order `names` gives them.
 *
 * KEYED BY ELEMENT rather than declared by the mount, because a row's `update` writes the same
 * element from a function of its own and both have to read one record.
 */
const owned = new WeakMap<
    Element,
    {
        text: string | undefined
        declared: Map<string, [value: string, priority: string]> | undefined
        values: readonly unknown[] | undefined
        names: string[]
    }
>()

// THE PARSE IS THE BROWSER'S OWN: a declaration list is not split on `;` by hand, since one can sit
// inside `url()` or a string. A detached element's style is parsed and never laid out.
let parsed: CSSStyleDeclaration | undefined

/** A declaration list's properties, values and priorities, as the browser parses it. */
function declarationsOf(
    text: string,
): Map<string, [value: string, priority: string]> {
    parsed ??= document.createElement('div').style
    parsed.cssText = text
    const declared = new Map<string, [value: string, priority: string]>()
    for (let index = 0; index < parsed.length; index += 1) {
        const property = parsed.item(index)
        declared.set(property, [
            parsed.getPropertyValue(property),
            parsed.getPropertyPriority(property),
        ])
    }
    return declared
}

/**
 * Writes a `style={expr}` and the `style:prop` directives beside it as one group, through the
 * CSSOM: `plain` is the attribute's value, and `values` each directive's, in the order of `names`,
 * its properties space-separated.
 *
 * 32.71 — ONLY ITS OWN PROPERTIES, in the server's cascade: the attribute's declarations, then
 * each directive's in the tag's order (`styleValue`), a later one winning and one with no value
 * declaring nothing. Only what moved is written. The attribute is parsed only when its text
 * changed — never on the first run, whose value the served page or built row already carries —
 * and every write is guarded by a compare. Where the attribute changed or a directive emptied,
 * the cascade is laid again from the attribute, which is how a shorthand on one side and a
 * longhand on the other resolve as they did in the server's list.
 */
export function setStyleGroup(
    element: Element,
    names: string,
    plain: unknown,
    values: readonly unknown[],
): void {
    WORK.bindingRuns += 1
    let held = owned.get(element)
    if (held === undefined) {
        held = {
            text: undefined,
            declared: undefined,
            values: undefined,
            names: names.split(' '),
        }
        owned.set(element, held)
    }
    const style = (element as HTMLElement).style
    const text = textOf(plain)
    const was = held.values
    // The first directive to write again, every one after it too: a later one wins.
    let from = -1
    if (held.text === undefined) held.text = text
    else if (text !== held.text) {
        const before = held.declared ?? declarationsOf(held.text)
        const after = declarationsOf(text)
        for (const property of before.keys())
            if (!after.has(property) && style.getPropertyValue(property) !== '')
                style.removeProperty(property)
        lay(style, after)
        held.text = text
        held.declared = after
        from = 0
    }
    for (let at = 0; at < held.names.length && from !== 0; at += 1) {
        const value = directiveValue(values[at])
        if (was !== undefined && directiveValue(was[at]) === value) continue
        if (value !== '' || was === undefined) {
            if (from === -1 && value !== '') from = at
            continue
        }
        const name = held.names[at] as string
        if (style.getPropertyValue(name) !== '') style.removeProperty(name)
        held.declared ??= declarationsOf(held.text)
        lay(style, held.declared)
        from = 0
    }
    if (from !== -1)
        for (let at = from; at < held.names.length; at += 1) {
            const value = directiveValue(values[at])
            const name = held.names[at] as string
            if (value !== '' && style.getPropertyValue(name) !== value)
                style.setProperty(name, value)
        }
    held.values = values
}

/** A directive's value, cut as the server cuts it; `''` declares nothing. */
function directiveValue(value: unknown): string {
    return oneStyleValue(textOf(value))
}

/** Writes each declaration the element does not already carry. */
function lay(
    style: CSSStyleDeclaration,
    declared: Map<string, [value: string, priority: string]>,
): void {
    for (const [property, [value, priority]] of declared)
        if (
            style.getPropertyValue(property) !== value ||
            style.getPropertyPriority(property) !== priority
        )
            style.setProperty(property, value, priority)
}
