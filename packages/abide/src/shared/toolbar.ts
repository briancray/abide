// 51.185-51.189 — CONTROLS SHARING ONE TAB STOP: WAI-ARIA's toolbar, and its menubar, as parts an app
// spreads onto a container and each control of its own. Tab reaches the toolbar once, at the item
// focused last, and the arrow keys along it move focus between its items. A menubar is a toolbar whose
// items are menu triggers: the menus it holds take its `id` as their `group`, and `menu` switches
// between them as one is open (50.57).
//
// THE ITEMS ARE THE ELEMENTS CARRYING `item`, found by their `bind:element` rather than handed as a
// list: an item is a control — a button, a `toggle`, a `menu`'s trigger — with no data of its own, and
// the toolbar keeps the `tabindex` of the elements it was handed alone.

import { BIND_ELEMENT } from './BIND_ELEMENT.ts'
import { byDocumentOrder } from './byDocumentOrder.ts'
import { isEditableTarget } from './isEditableTarget.ts'
import { type Live, live } from './live.ts'
import { madeId } from './madeId.ts'
import type { Disposer } from './reactive/watch.ts'
import { roving } from './roving.ts'

/** What the toolbar is called, which way it runs, and whether it is a menubar. */
export type ToolbarOptions = {
    /** Its id; unique on the page, and the `group` the menus of a menubar take. One is made where none is given. */
    id?: string | undefined
    /** Its accessible name; a function is read live. */
    label?: Live<string | undefined> | undefined
    /** Which way it runs, and so which arrow keys move along it. `'horizontal'` by default; a function is read live. */
    orientation?: Live<'horizontal' | 'vertical'> | undefined
    /** Whether the arrow keys go round its ends. `true` by default; a function is read live. */
    wrap?: Live<boolean> | undefined
    /** `'menubar'` for a row of menus, its items menu items. `'toolbar'` by default. Read once. */
    role?: 'toolbar' | 'menubar' | undefined
}

/** The parts `toolbar` hands back: `<div {...tools.toolbar}>`, `<button {...tools.item}>`. */
export type Toolbar = {
    /** Its id, and the `group` the menus of a menubar take. */
    readonly id: string
    /** The container's role, name, orientation and keys. */
    readonly toolbar: Record<string, unknown>
    /** What each control in it carries: the tab stop it shares with the others. */
    readonly item: Record<string, unknown>
}

/** WAI-ARIA's toolbar, or its menubar: controls sharing one tab stop, walked by the arrow keys. */
export function toolbar(options: ToolbarOptions = {}): Toolbar {
    const role = options.role ?? 'toolbar'
    const id = options.id ?? madeId(role)
    const orientation = () => live(options.orientation) ?? 'horizontal'

    // Every item standing, and the one Tab reaches: the item focused last, or the first in the document.
    const items = new Set<HTMLElement>()
    let current: HTMLElement | undefined
    const ordered = (): HTMLElement[] => {
        const listed = [...items]
        listed.sort(byDocumentOrder)
        return listed
    }
    // 51.186 — one item in the tab order, and every other out of it.
    const settle = (): void => {
        if (current === undefined || !items.has(current)) current = ordered()[0]
        for (const item of items)
            item.setAttribute('tabindex', item === current ? '0' : '-1')
    }
    // Items arriving and leaving together settle once.
    let settling = false
    const settleSoon = (): void => {
        if (settling) return
        settling = true
        queueMicrotask(() => {
            settling = false
            settle()
        })
    }

    // 51.189 — a toolbar's item writes no role, so it leaves the one a control spread beside it writes.
    const item: Record<string, unknown> = {
        ...(role === 'menubar' ? { role: 'menuitem' } : {}),
        'data-toolbar': 'item',
        [BIND_ELEMENT]: (element: HTMLElement): Disposer => {
            items.add(element)
            settleSoon()
            return () => {
                items.delete(element)
                settleSoon()
            }
        },
    }

    // 51.185
    const bar = {
        id,
        role,
        'data-toolbar': role === 'menubar' ? 'menubar' : 'toolbar',
        get 'aria-label'() {
            return live(options.label)
        },
        get 'aria-orientation'() {
            return orientation()
        },
        // 51.186 — focus reaching an item makes it the one Tab reaches.
        onfocusin: (event: FocusEvent) => {
            const target = event.target as HTMLElement
            if (target === current || !items.has(target)) return
            current = target
            settle()
        },
        // 51.187, 51.188 — the arrows along it and Home and End move focus between its items, save a key
        // a control inside it took, or one typing into a field.
        onkeydown: (event: KeyboardEvent) => {
            const target = event.target as HTMLElement
            if (
                event.defaultPrevented ||
                !items.has(target) ||
                isEditableTarget(target)
            )
                return
            const listed = ordered().filter(
                (each) => !(each as HTMLButtonElement).disabled,
            )
            const to = roving(
                event.key,
                orientation(),
                () => [listed.indexOf(target), listed.length],
                live(options.wrap) ?? true,
            )
            if (to === -1) return
            event.preventDefault()
            current = listed[to]
            settle()
            current?.focus()
        },
    }

    return { id, toolbar: bar, item }
}
