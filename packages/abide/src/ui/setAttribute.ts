import { attributeText } from '#shared/attributeText.ts'
import { FOREIGN_ATTRIBUTES } from '#shared/FOREIGN_ATTRIBUTES.ts'
import { HTML_NAMESPACE } from '#shared/INTEGRATION_POINTS.ts'
import { numberFromText } from '#shared/numberFromText.ts'
import { WORK } from '#shared/WORK.ts'

/**
 * Writes, or removes, a bound attribute, skipping an unchanged write.
 *
 * 32.3 — what an attribute binding writes, and the client half the server never had: `emitComponent`
 * writes the value standing at render and, without this, nothing writes it again.
 *
 * NOT ESCAPED, for `escapeless`'s reason: the server concatenates into markup a browser parses, and
 * `setAttribute` is not a parse. Escaping here would put `&amp;` in a `title` where the server put
 * `&`.
 *
 * 32.37 — PRESENT, ABSENT OR TEXT is `attributeText`'s answer, the one the server's markup took, so
 * `disabled={busy}` going false removes the attribute the server wrote, and 32.20's scheme check is
 * the same call on both sides.
 *
 * THE COMPARE IS THE REST OF THE POINT. `getAttribute` reads a value the element already holds —
 * it is not a layout read and forces nothing — and a binding rerun by a value that landed on the
 * same string is the common case rather than the rare one, so the branch is cheaper than the
 * mutation it skips.
 */
export function setAttribute(
    element: Element,
    name: string,
    value: unknown,
): void {
    WORK.bindingRuns += 1
    writeAttributeText(element, name, attributeText(name, value))
}

/**
 * `setAttribute` on a form control's `value`, `checked` or `selected`, which also keeps the property
 * of that name written (32.113). Which attributes take it is the compiler's to decide, per element,
 * so the attribute every other binding writes pays no branch for it.
 *
 * THE ATTRIBUTE IS WHAT THE BINDING LAST WROTE — the reader's typing moves the property and never
 * the attribute — so the property is written only when the attribute's text moved. A rerun landing
 * on the text already written leaves what the reader typed alone.
 */
export function setControl(
    element: Element,
    name: string,
    value: unknown,
): void {
    WORK.bindingRuns += 1
    const next = attributeText(name, value)
    if (writeAttributeText(element, name, next))
        writeControl(element, name, next)
}

/**
 * 32.113 — THE PROPERTY A CONTROL SHOWS, written from the text `attributeText` answered: the text
 * itself for `value`, `''` where it is absent, and presence for `checked` and `selected`. Called
 * only where that text moved, and compared even then: a write of the text the field already holds
 * would put the caret back at its end.
 */
export function writeControl(
    element: Element,
    name: string,
    text: string | null,
): void {
    const control = element as HTMLInputElement & HTMLOptionElement
    if (name === 'value') {
        const shown = text ?? ''
        const standing = control.value
        if (standing === shown) return
        // 32.59's reason, for a value written rather than bound: text that already reads as the
        // number written is the reader's spelling of it — `1.` on its way to `1.5` — and the
        // handler that wrote `1` from it would otherwise take the keystroke back.
        const number = numberFromText(shown)
        if (number !== undefined && number === numberFromText(standing)) return
        control.value = shown
        return
    }
    const on = text !== null
    if (name === 'checked') {
        if (control.checked !== on) control.checked = on
    } else if (control.selected !== on) control.selected = on
}

/**
 * Writes text `attributeText` answered, or removes the attribute where it answered `null` — and
 * answers whether the attribute moved.
 */
function writeAttributeText(
    element: Element,
    name: string,
    text: string | null,
): boolean {
    if (text === null) {
        if (!element.hasAttribute(name)) return false
        element.removeAttribute(name)
        return true
    }
    return writeAttribute(element, name, text)
}

/**
 * Writes `text` to `element`'s `name` unless it already reads `text` — `setAttribute`'s compare,
 * shared with a spread — and answers whether it wrote.
 */
export function writeAttribute(
    element: Element,
    name: string,
    text: string,
): boolean {
    const standing = element.getAttribute(name)
    if (standing === text) return false
    if (standing === null) addAttribute(element, name, text)
    else element.setAttribute(name, text)
    return true
}

/**
 * Writes an attribute `element` does not hold yet, in the namespace the parser gives it there.
 *
 * 32.70 — an `xlink:href` on an SVG element is XLink's (`FOREIGN_ATTRIBUTES`), and one
 * `setAttribute` makes has none, so a `<use>` it names draws nothing. Only an attribute's CREATION
 * decides its namespace: `setAttribute` and `getAttribute` find a standing one by its qualified
 * name, whatever namespace it is in.
 */
export function addAttribute(
    element: Element,
    name: string,
    text: string,
): void {
    const space = FOREIGN_ATTRIBUTES.get(name)
    if (space === undefined || element.namespaceURI === HTML_NAMESPACE)
        element.setAttribute(name, text)
    else element.setAttributeNS(space, name, text)
}
