// 50.26-50.32, 50.37-50.40 — A BUTTON AND THE ACTIONS IT OPENS: WAI-ARIA's menu button, as two
// parts an app spreads onto elements of its own. The menu is an auto popover, so a click anywhere
// else and a second popover opening close it with no listener here; the server writes every
// attribute, so the menu is shut before the page hydrates.

import { anchored } from './anchored.ts'
import { checkParts } from './checkParts.ts'
import { type Live, live } from './live.ts'
import type { Side } from './place.ts'
import type { PopoverOptions } from './popover.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { openingEnd, roving, typeahead } from './roving.ts'

/** Where a menu opens against its trigger, placed as a `popover` is, and what hears it open and close. */
export type MenuOptions = Omit<PopoverOptions, 'align' | 'offset'> & {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string
    /** Whether the menu is open: hand it a `Reactive` to read and write it, and every way it closes writes `false` back. */
    open?: Reactive<boolean>
    /** Which edge of the trigger the menu lines up with. Default `'start'`; a function is read at each placement. */
    align?: Live<'start' | 'center' | 'end'>
    /** Pixels between the trigger and the menu. Default `4`; a function is read at each placement. */
    offset?: Live<number>
    /** 50.37 — called each time the menu opens. */
    onopen?: () => void
    /** 50.37 — called each time the menu closes, however it closed. */
    onclose?: () => void
}

/** The two parts `menu` hands back, each spread onto an element: `<button {...actions.trigger}>`. */
export type Menu = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The trigger's attributes and listeners. */
    readonly trigger: Record<string, unknown>
    /** The menu's attributes and listeners; its children carrying a menu item role are its items. */
    readonly menu: Record<string, unknown>
    /** Whether the menu is open — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
}

// 50.29, 50.38 — the items the keys walk and a click picks.
const ITEM =
    ':is([role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]):not([disabled]):not([aria-disabled=true])'

/** WAI-ARIA's menu button: a trigger and the menu it opens, as two parts to spread. */
export function menu(options: MenuOptions = {}): Menu {
    // 49.13 — read where they are used: every placement option a `popover` takes, under a
    // menu's own defaults (50.19-50.21), at each placement.
    const side = () => live(options.side) ?? 'bottom'
    const placing = {
        ...options,
        side,
        align: () => live(options.align) ?? 'start',
        offset: () => live(options.offset) ?? 4,
    }
    const open = options.open ?? reactive(false)
    const placed = reactive<Side>(side())
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the two
    // ids are rewritten together.
    const menuId = options.id ?? `menu-${randomToken(4, 'hex')}`
    const triggerId = `${menuId}-trigger`
    if (process.env.NODE_ENV !== 'production') checkParts('menu', menuId)
    const triggerOf = () => document.getElementById(triggerId)
    const menuOf = () => document.getElementById(menuId)
    let stop: (() => void) | undefined
    // Whether the menu was open as the trigger was pressed: a press outside an open popover closes it
    // before the click lands, and the click must not open it again (50.32).
    let openAtPress = false
    const typedTo = typeahead()

    const items = (): HTMLElement[] => {
        const list = menuOf()
        return list === null
            ? []
            : [...list.querySelectorAll<HTMLElement>(ITEM)]
    }

    // Which item takes focus as the menu opens: the last where ArrowUp opened it (50.28).
    let focusOnOpen: 'first' | 'last' = 'first'
    const show = (focused: 'first' | 'last'): void => {
        const list = menuOf()
        if (list === null || list.matches(':popover-open')) return
        focusOnOpen = focused
        list.showPopover()
    }
    const hide = (): void => {
        const list = menuOf()
        if (list?.matches(':popover-open')) list.hidePopover()
    }
    // 50.37 — the popover's own state is the truth: every way it opens or closes arrives here.
    const toggled = (event: Event): void => {
        const list = event.currentTarget as HTMLElement
        if ((event as ToggleEvent).newState === 'open') {
            const button = triggerOf()
            if (button !== null)
                stop = anchored(button, list, placing, (placement) =>
                    placed.set(placement.side),
                )
            if (!open.peek()) open.set(true)
            const listed = items()
            listed[focusOnOpen === 'first' ? 0 : listed.length - 1]?.focus()
            options.onopen?.()
            return
        }
        stop?.()
        stop = undefined
        if (open.peek()) open.set(false)
        options.onclose?.()
    }

    // 50.37 — `open` written by the app opens and closes the popover.
    open.watch((wanted) => {
        if (typeof document === 'undefined') return
        const list = menuOf()
        if (list === null || list.matches(':popover-open') === wanted) return
        if (wanted) show('first')
        else hide()
    })

    const trigger = {
        id: triggerId,
        'data-part': 'trigger',
        'aria-haspopup': 'menu',
        'aria-controls': menuId,
        get 'aria-expanded'() {
            return open() ? 'true' : 'false'
        },
        onpointerdown: () => {
            openAtPress = open.peek() === true
        },
        onclick: () => {
            if (open.peek() || openAtPress) hide()
            else show('first')
            openAtPress = false
        },
        onkeydown: (event: KeyboardEvent) => {
            const end = openingEnd(event.key, 'vertical')
            if (end === undefined) return
            event.preventDefault()
            show(end)
        },
    }

    const list = {
        id: menuId,
        role: 'menu',
        'data-part': 'menu',
        popover: 'auto',
        'aria-labelledby': triggerId,
        get 'data-side'() {
            return placed()
        },
        get 'data-open'() {
            return open() ? '' : undefined
        },
        ontoggle: toggled,
        onkeydown: (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                hide()
                triggerOf()?.focus()
                return
            }
            if (event.key === 'Tab') return hide()
            const listed = items()
            const at = listed.indexOf(document.activeElement as HTMLElement)
            const roved = roving(event.key, 'vertical', () => [
                at,
                listed.length,
            ])
            const next =
                roved === -1
                    ? typedTo(event, at, listed.length, (index) =>
                          (listed[index]?.textContent ?? '').trim(),
                      )
                    : roved
            if (next === -1) return
            event.preventDefault()
            listed[next]?.focus()
        },
        // 50.31, 50.39 — a pick closes the menu and hands focus back; a checkbox or radio item
        // changes its state with the menu left open.
        onclick: (event: MouseEvent) => {
            if (!(event.target instanceof Element)) return
            const item = event.target.closest(ITEM)
            if (item === null) return
            if (item.getAttribute('role') !== 'menuitem') return
            hide()
            triggerOf()?.focus()
        },
    }

    return { id: menuId, trigger, menu: list, open }
}
