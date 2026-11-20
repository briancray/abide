// 53.21-53.23, 53.44, 53.45 — A CLICK THAT COPIES, and the element marked once the copy lands.

import type { Disposer } from './reactive/watch.ts'

/**
 * The `bind:element` adaptor copying text to the clipboard when the element is clicked, and writing
 * `data-copied` on it for `copiedFor` milliseconds once the copy landed.
 *
 * 53.44 — WITH `selector`, THE ELEMENT HOLDS THE BUTTONS RATHER THAN BEING ONE: a click inside it
 * on an element matching `selector` copies, and that element is marked. One listener reaches buttons
 * written by markup no template built, which is what a `raw` block holds.
 *
 * @param text the text, or a function read at the click — handed the element clicked — for text that changes
 * @param options how long `data-copied` stays, the buttons inside the element, and what hears the outcome
 */
export function copyText(
    text: string | ((clicked: Element) => string),
    options: {
        /** How long `data-copied` stays on the element after a copy, in milliseconds. 1500 by default. */
        copiedFor?: number
        /** The buttons inside the element a click copies from, in place of the element itself. */
        selector?: string
        /** 53.45 — called once a click's copy has landed or failed, with whether it landed and the element clicked. */
        oncopied?: (copied: boolean, clicked: Element) => void
    } = {},
): (element: Element) => Disposer {
    const { copiedFor = 1500, selector, oncopied } = options
    return (element) => {
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
            const copied = await writeText(
                typeof text === 'function' ? text(clicked) : text,
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
}

/**
 * 53.22 — whether `text` reached the clipboard. `navigator.clipboard` exists in a secure context
 * alone, so a page served over plain http copies through a selected textarea instead.
 */
async function writeText(text: string): Promise<boolean> {
    if (navigator.clipboard !== undefined)
        try {
            await navigator.clipboard.writeText(text)
            return true
        } catch {
            // Refused: no focus, or no permission. The textarea may still copy.
        }
    const focused = document.activeElement
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    let copied = false
    try {
        copied = document.execCommand('copy')
    } catch {
        copied = false
    }
    field.remove()
    if (focused instanceof HTMLElement) focused.focus()
    return copied
}
