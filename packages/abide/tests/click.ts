import { flushSync } from '#shared'

/** Click the element `selector` finds, and flush what the click scheduled. */
export function click(selector: string): void {
    ;(document.querySelector(selector) as HTMLElement).click()
    flushSync()
}
