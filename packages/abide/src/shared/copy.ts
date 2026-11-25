// 53.21, 53.23, 53.43, 53.44, 53.79 — A CLICK THAT COPIES, and the element marked once the copy lands.

import { type Copyable, copyToClipboard } from './copyToClipboard.ts'
import type { Disposer } from './reactive/watch.ts'

/** 53.79 — the element clicked, as the text it reads and the markup it holds. */
const contentOf = (clicked: Element): Copyable => ({
    'text/plain': clicked.textContent ?? '',
    'text/html': clicked.innerHTML,
})

/**
 * The part copying to the clipboard when the element it is spread on is clicked — its own text
 * and markup by default, or a `value`: text, or a record of MIME type to what it holds (`text/html`
 * beside `text/plain`, `image/png`) — and writing `data-copied` on it for `copiedFor` milliseconds
 * once the copy landed.
 *
 * 53.43 — WITH `selector`, THE ELEMENT HOLDS THE BUTTONS RATHER THAN BEING ONE: a click inside it
 * on an element matching `selector` copies, and that element is marked. One listener reaches buttons
 * written by markup no template built, which is what a `raw` block holds.
 *
 * @param options what to copy, how long `data-copied` stays, the buttons inside the element, and what hears the outcome
 */
export function copy(
    options: {
        /** What to copy, or a function read at the click — handed the element clicked — for a value that changes. The element clicked's text and markup by default. */
        value?: Copyable | ((clicked: Element) => Copyable) | undefined
        /** How long `data-copied` stays on the element after a copy, in milliseconds. 1500 by default. */
        copiedFor?: number | undefined
        /** The buttons inside the element a click copies from, in place of the element itself. */
        selector?: string | undefined
        /** 53.44 — called once a click's copy has landed or failed, with whether it landed and the element clicked. */
        oncopied?: ((copied: boolean, clicked: Element) => void) | undefined
    } = {},
): Record<string, unknown> {
    const { value = contentOf, copiedFor = 1500, selector, oncopied } = options
    const bind = (element: Element): Disposer => {
        const clearing = new Map<Element, ReturnType<typeof setTimeout>>()
        let bound = true
        const click = async (event: Event): Promise<void> => {
            const clicked =
                selector === undefined
                    ? element
                    : event.target instanceof Element
                      ? event.target.closest(selector)
                      : null
            if (clicked === null || !element.contains(clicked)) return
            // Read and written inside the click: Safari writes the clipboard from a gesture alone.
            const copied = await copyToClipboard(
                typeof value === 'function' ? value(clicked) : value,
            )
            if (!bound) return
            oncopied?.(copied, clicked)
            if (!copied) return
            clicked.setAttribute('data-copied', '')
            clearTimeout(clearing.get(clicked))
            clearing.set(
                clicked,
                setTimeout(() => {
                    clearing.delete(clicked)
                    clicked.removeAttribute('data-copied')
                }, copiedFor),
            )
        }
        element.addEventListener('click', click)
        return () => {
            bound = false
            element.removeEventListener('click', click)
            for (const timer of clearing.values()) clearTimeout(timer)
        }
    }
    return { 'data-copy': 'host', 'bind:element': bind }
}
