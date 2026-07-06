import { effect } from '../effect.ts'
import { on } from './on.ts'

/*
Two-way `bind:value` for a `<select>`. The bound value drives the selection through
a reactive effect, and the user's pick writes back on `change`. A plain `bind:value`
would set `el.value` once, up front — but a `<select>`'s options are frequently
mounted AFTER the binding runs (a `{#for}` child, an async list), and the browser
silently drops a `value` assignment naming an option that isn't present yet. So a
`MutationObserver` re-applies the selection whenever the option set changes (its
callback runs in a microtask before paint, so no visible flash), disconnected on
teardown. `multiple` switches single-value (`el.value`) semantics for array
membership: each option's `selected` is set from the bound array, and the write-back
collects `selectedOptions` back into an array.
*/
// @documentation plumbing
export function bindSelectValue(
    element: HTMLSelectElement,
    read: () => unknown,
    write: (value: unknown) => void,
    multiple: boolean,
): void {
    /* Push the bound value into the DOM selection. */
    const apply = (): void => {
        if (multiple) {
            const selected = (read() as unknown[]) ?? []
            for (const option of element.options) {
                option.selected = selected.includes(option.value)
            }
        } else {
            element.value = read() as string
        }
    }
    /* Read the current DOM selection back out for the write. */
    const collect = (): unknown =>
        multiple ? Array.from(element.selectedOptions, (option) => option.value) : element.value
    /* Re-apply whenever the bound value changes (this effect tracks `read`). */
    effect(apply)
    /* Re-apply whenever the option set changes — covers `{#for}`/async options that
       mount after the first apply. This effect reads nothing reactive, so it runs once
       and only its teardown (disconnect) fires on dispose. */
    effect(() => {
        const observer = new MutationObserver(apply)
        observer.observe(element, { childList: true, subtree: true })
        return () => observer.disconnect()
    })
    on(element, 'change', () => write(collect()))
}
