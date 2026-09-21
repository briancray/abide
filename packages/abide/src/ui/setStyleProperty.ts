import { oneStyleValue } from '#shared/escapeText.ts'
import { textOf } from '#shared/Raw.ts'
import { WORK } from '#shared/WORK.ts'

// 32.10 on the client — `style:prop` sets ONE property, and keeps setting it. Written through the
// CSSOM rather than through the `style` attribute the server built, because the server MERGED every
// `style:prop` on the element into that one attribute: writing the attribute back would take the
// other declarations with it, where `setProperty` touches exactly the one this binding owns.
//
// THE CUT IS THE SAME CUT THE SERVER MAKES, and sharing it is the whole reason it is a function.
// `escapeStyleValue` drops everything from the first `;` because a value carrying one declares
// more than one property; the CSSOM refuses such a value outright, so without this the server
// renders `color: red` from `red; position: fixed` and the first binding run removes it — one
// injection guard, two different answers. The ESCAPING is not shared: an attribute value is parsed
// and a CSSOM value is not, which is `escapeless`'s distinction again.
export function setStyleProperty(
    element: Element,
    property: string,
    value: unknown,
): void {
    WORK.bindingRuns += 1
    const style = (element as HTMLElement).style
    const next = oneStyleValue(textOf(value))
    if (style.getPropertyValue(property) !== next)
        style.setProperty(property, next)
}
