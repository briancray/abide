import { isReactive } from '#shared/reactive/isReactive.ts'
import type { Disposer } from '#shared/reactive/watch.ts'

// 32.9 — THE NODE, HANDED OVER. Two forms and one call site: a `Reactive` of an element takes
// the node as its value, and a callback takes it as its argument and may hand back a `Disposer`
// — which is what a third-party widget wants, set up where the node arrives and torn down where
// it goes, rather than in a pair of lifecycle hooks that have to be kept in step.
//
// THE BRAND IS READ FIRST (1.6). A `Reactive` is callable and thenable, so a test for a function
// answers true for one — and the reference would have been handed to the value instead of being
// put in it.
//
// A `Reactive` IS NOT CLEARED ON TEARDOWN. Nothing decides that it should be: the clause says
// the value accepts an element, and a page that reads `field.focus()` from a handler after a
// region swapped is reading a node that left rather than a value that emptied. The callback
// form is where teardown is decided, and its `Disposer` is the whole of it.
export function bindElement(
    element: Element,
    value: unknown,
): Disposer | undefined {
    if (isReactive(value)) {
        ;(value as unknown as { set(next: unknown): void }).set(element)
        return undefined
    }
    if (typeof value !== 'function') return undefined
    const disposer = (value as (node: Element) => Disposer | void)(element)
    return typeof disposer === 'function' ? disposer : undefined
}
