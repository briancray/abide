// 53.21-53.23 — A CLICK THAT COPIES, and the element marked once the copy lands.

import type { Disposer } from './reactive/watch.ts'

/**
 * The `bind:element` adaptor copying text to the clipboard when the element is clicked, and writing
 * `data-copied` on it for `copiedFor` milliseconds once the copy landed.
 *
 * @param text the text, or a function read at the click for text that changes
 * @param options how long `data-copied` stays
 */
export function copyText(
    text: string | (() => string),
    options: {
        /** How long `data-copied` stays on the element after a copy, in milliseconds. 1500 by default. */
        copiedFor?: number
    } = {},
): (element: Element) => Disposer {
    const copiedFor = options.copiedFor ?? 1500
    return (element) => {
        let clearing: ReturnType<typeof setTimeout> | undefined
        let bound = true
        const click = async (): Promise<void> => {
            const copied = await writeText(
                typeof text === 'function' ? text() : text,
            )
            if (!copied || !bound) return
            element.setAttribute('data-copied', '')
            clearTimeout(clearing)
            clearing = setTimeout(
                () => element.removeAttribute('data-copied'),
                copiedFor,
            )
        }
        element.addEventListener('click', click)
        return () => {
            bound = false
            element.removeEventListener('click', click)
            clearTimeout(clearing)
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
