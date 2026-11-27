// 51.120, 51.121 — A STACK OF DISCLOSURES, at most one open or any number, as parts an app spreads
// onto a button and a region per key of its own: WAI-ARIA's accordion. Each key's parts are a
// `disclosure`, open while `open` holds the key, carrying `data-accordion` beside `data-disclosure`.

import { type Disclosure, disclosure } from './disclosure.ts'
import type { ItemKey } from './itemKey.ts'
import { madeId } from './madeId.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import type { Picked } from './Selection.ts'
import { withPart } from './withPart.ts'

/** Which keys are open, and whether many may be at once. */
export type AccordionOptions<
    Multiple extends boolean = false,
    Key extends ItemKey = string,
> = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** Whether any number may be open at once. `false` by default: opening one closes the one open. */
    multiple?: Multiple | undefined
    /** The key open, or every key open where many may be: a `Reactive` to read and set. Held by the parts, and handed back as `open`, where none is given. */
    open?: Reactive<Picked<Key, Multiple>> | undefined
}

/** The parts `accordion` hands back: `<button {...faq.item('pricing').button}>`. */
export type Accordion<
    Multiple extends boolean = false,
    Key extends ItemKey = string,
> = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** A key's button and region: a `disclosure`'s parts. */
    item(key: Key): Disclosure
    /** The key open, or every key open where many may be; written, it opens and closes. */
    readonly open: Reactive<Picked<Key, Multiple>>
}

/** WAI-ARIA's accordion: a disclosure per key, at most one open unless `multiple`. */
export function accordion<
    Multiple extends boolean = false,
    Key extends ItemKey = string,
>(options: AccordionOptions<Multiple, Key> = {}): Accordion<Multiple, Key> {
    const many = options.multiple === true
    const open = (options.open ??
        (many
            ? reactive<readonly Key[]>([])
            : reactive<Key | undefined>(undefined))) as Reactive<
        Picked<Key, boolean>
    >
    const base = options.id ?? madeId('accordion')
    const isOpen = (key: Key): boolean => {
        const now = open()
        return many
            ? ((now as readonly Key[]) ?? []).includes(key)
            : now === key
    }
    // 51.121 — picking one, opening a key is the only key open, and closing it leaves none.
    const write = (key: Key, on: boolean): unknown => {
        if (!many) return open.set(on ? key : undefined)
        const now = (open.peek() as readonly Key[] | undefined) ?? []
        const kept = now.filter((each) => each !== key)
        return open.set(on ? [...kept, key] : kept)
    }
    // 51.120 — each key's parts built once and kept, so a render asking again builds nothing.
    const items = new Map<Key, Disclosure>()
    const item = (key: Key): Disclosure => {
        let made = items.get(key)
        if (made === undefined) {
            made = disclosure({
                id: `${base}-${encodeURIComponent(key)}`,
                open: reactiveOver(
                    () => isOpen(key),
                    (on: boolean) => write(key, on),
                ),
            })
            // 49.3 — a disclosure's parts, named for the accordion beside the disclosure.
            withPart(made.button, { 'data-accordion': 'button' })
            withPart(made.region, { 'data-accordion': 'region' })
            items.set(key, made)
        }
        return made
    }
    return {
        id: base,
        item,
        open: open as Reactive<Picked<Key, Multiple>>,
    }
}
