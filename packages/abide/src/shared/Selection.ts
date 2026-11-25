// 51.98-51.103 — WHAT A PICK DOES TO A SELECTION, of one key or of many: what `listbox` and `tree`
// share about it. Over many, a press picks its item alone, toggles it with the platform's `mod` held,
// and with Shift selects the run of the list from the anchor — the item the last pick or toggle landed
// on — to it.

import { isApplePlatform } from './isApplePlatform.ts'
import { computed, type Reactive, reactive } from './reactive/index.ts'

/** What a pick holds: every one picked where it picks many, else the one picked or none. */
export type Picked<Item, Multiple extends boolean> = Multiple extends true
    ? readonly Item[]
    : Item | undefined

const NONE: ReadonlySet<string> = new Set()

/** 51.74, 51.100 — every key of `order` from `from` to `to`, either way round, or `undefined` where either is not listed. */
export function runOf(
    order: readonly string[],
    from: string,
    to: string,
): string[] | undefined {
    const start = order.indexOf(from)
    const end = order.indexOf(to)
    if (start === -1 || end === -1) return undefined
    return order.slice(Math.min(start, end), Math.max(start, end) + 1)
}

/** The keys a `listbox` or a `tree` holds selected, and the gestures that change them. */
export class Selection {
    readonly selected: Reactive<Picked<string, boolean>>
    readonly many: boolean
    // The keys selected as a set, read once per item an attribute asks about; only where it picks many.
    readonly keys: Reactive<ReadonlySet<string>>
    // 51.100 — where a range runs from.
    anchor: string | undefined = undefined

    constructor(
        selected: Reactive<Picked<string, boolean>> | undefined,
        many: boolean,
    ) {
        this.many = many
        this.selected =
            selected ??
            ((many
                ? reactive<readonly string[]>([])
                : reactive<string | undefined>(undefined)) as Reactive<
                Picked<string, boolean>
            >)
        const held = this.selected as Reactive<readonly string[] | undefined>
        this.keys = computed(() => (many ? new Set(held() ?? []) : NONE))
    }

    /** Whether `key` is selected, read live. */
    has(key: string): boolean {
        return this.many
            ? this.keys().has(key)
            : (this.selected as Reactive<string | undefined>)() === key
    }

    /** The keys selected, in the order they were. */
    list(): readonly string[] {
        const now = this.selected()
        if (this.many) return (now as readonly string[] | undefined) ?? []
        return now === undefined ? [] : [now as string]
    }

    /** Selects `key` alone. */
    pick(key: string): void {
        this.anchor = key
        this.selected.set(this.many ? [key] : key)
    }

    /** Adds `key` to the selection, or takes it out where it is in it already. */
    toggle(key: string): void {
        if (!this.many) return this.pick(key)
        this.anchor = key
        const now =
            (this.selected.peek() as readonly string[] | undefined) ?? []
        const kept = now.filter((each) => each !== key)
        this.selected.set(kept.length === now.length ? [...now, key] : kept)
    }

    /** 51.100 — selects the run of `order` from the anchor to `to`, the anchor being `from` where there is none listed. */
    extend(
        from: string | undefined,
        to: string,
        order: () => readonly string[],
    ): void {
        if (!this.many) return this.pick(to)
        const list = order()
        if (this.anchor === undefined || !list.includes(this.anchor))
            this.anchor = from ?? to
        const run = runOf(list, this.anchor, to)
        if (run === undefined) return this.pick(to)
        this.selected.set(run)
    }

    /** 51.101 — selects every key of `order`, where it picks many. */
    all(order: () => readonly string[]): void {
        if (this.many) this.selected.set([...order()])
    }

    /** 51.99 — a press on `key`: Shift extends to it from `from`, `mod` toggles it, and a bare press picks it alone. */
    press(
        key: string,
        event: MouseEvent,
        from: string | undefined,
        order: () => readonly string[],
    ): void {
        if (event.shiftKey) this.extend(from, key, order)
        else if (isApplePlatform() ? event.metaKey : event.ctrlKey)
            this.toggle(key)
        else this.pick(key)
    }
}
