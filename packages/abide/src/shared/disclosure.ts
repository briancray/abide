// 51.116-51.119 — A BUTTON THAT SHOWS AND HIDES A REGION: WAI-ARIA's disclosure, as parts an app
// spreads onto a button and a region of its own. The region is hidden `until-found`, so find in page
// reaches what it holds and opens it. What an `accordion` is made of, one per key, and what `clamp`'s
// button is.

import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** Whether the region is open, and the base of the ids its parts write. */
export type DisclosureOptions = {
    /** The base the region's id is derived from; unique on the page. One is made where none is given. */
    id?: string
    /** Whether the region is open: hand it a `Reactive` to read and write it. Held by the parts, and handed back as `open`, where none is given. */
    open?: Reactive<boolean>
}

/** The parts `disclosure` hands back: `<button {...more.button}>`, `<div {...more.region}>`. */
export type Disclosure = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The button's attributes and its click. */
    readonly button: Record<string, unknown>
    /** The region's attributes: hidden while it is shut. */
    readonly region: Record<string, unknown>
    /** Whether the region is open — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
}

/** WAI-ARIA's disclosure: a button and the region it shows and hides, as parts to spread. */
export function disclosure(options: DisclosureOptions = {}): Disclosure {
    const open = options.open ?? reactive(false)
    // Hydration runs setup again (41.6), and the button's `aria-controls` is bound to it.
    const id = options.id ?? `disclosure-${randomToken(4, 'hex')}`
    const regionId = `${id}-region`
    const isOpen = () => (open() ? '' : undefined)
    return {
        id,
        // 51.116, 51.119
        button: {
            type: 'button',
            'data-disclosure': 'button',
            'aria-controls': regionId,
            get 'aria-expanded'() {
                return open() ? 'true' : 'false'
            },
            get 'data-open'() {
                return isOpen()
            },
            onclick: () => open.set(!open.peek()),
        },
        region: {
            id: regionId,
            'data-disclosure': 'region',
            // 51.117
            get hidden() {
                return open() ? undefined : 'until-found'
            },
            get 'data-open'() {
                return isOpen()
            },
            // 51.118
            onbeforematch: () => open.set(true),
        },
        open,
    }
}
