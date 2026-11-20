// 50.26-50.32, 50.37-50.40 — A BUTTON AND THE ACTIONS IT OPENS: WAI-ARIA's menu button, as two
// parts an app spreads onto elements of its own. The menu is an auto popover, so a click anywhere
// else and a second popover opening close it with no listener here; the server writes every
// attribute, so the menu is shut before the page hydrates.

import { follow } from './follow.ts'
import type { Side } from './place.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** Where a menu opens against its trigger, and what hears it open and close. */
export type MenuOptions = {
    /** Whether the menu is open: hand it a `Reactive` to read and write it, and every way it closes writes `false` back. */
    open?: Reactive<boolean>
    /** The side of the trigger the menu opens on, flipped to the opposite one where it has no room. Default `'bottom'`. Written as `data-side` on the menu. */
    side?: Side
    /** Which edge of the trigger the menu lines up with. Default `'start'`. */
    align?: 'start' | 'center' | 'end'
    /** Pixels between the trigger and the menu. Default `4`. */
    offset?: number
    /** Pixels the arrow's `--arrow-offset` keeps from each end of the menu's facing edge. Default `0`. */
    arrowInset?: number
    /** 50.37 — called each time the menu opens. */
    onopen?: () => void
    /** 50.37 — called each time the menu closes, however it closed. */
    onclose?: () => void
}

/** The two parts `menu` hands back, each spread onto an element: `<button {...actions.trigger}>`. */
export type Menu = {
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
// 50.40 — how long typed letters keep adding to the text an item is looked for by.
const TYPED_FOR = 500

/** WAI-ARIA's menu button: a trigger and the menu it opens, as two parts to spread. */
export function menu(options: MenuOptions = {}): Menu {
    const {
        side = 'bottom',
        align = 'start',
        offset = 4,
        arrowInset = 0,
        onopen,
        onclose,
    } = options
    const open = options.open ?? reactive(false)
    const placed = reactive<Side>(side)
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the two
    // ids are rewritten together.
    const base = randomToken(4, 'hex')
    const triggerId = `menu-trigger-${base}`
    const menuId = `menu-${base}`
    const triggerOf = () => document.getElementById(triggerId)
    const menuOf = () => document.getElementById(menuId)
    let stop: (() => void) | undefined
    // Whether the menu was open as the trigger was pressed: a press outside an open popover closes it
    // before the click lands, and the click must not open it again (50.32).
    let openAtPress = false
    let typed = ''
    let typedAt = 0

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
                stop = follow(
                    button,
                    list,
                    { side, align, offset, arrowInset },
                    (placement) => placed.set(placement.side),
                )
            if (!open.peek()) open.set(true)
            const listed = items()
            listed[focusOnOpen === 'first' ? 0 : listed.length - 1]?.focus()
            onopen?.()
            return
        }
        stop?.()
        stop = undefined
        if (open.peek()) open.set(false)
        onclose?.()
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
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            show(event.key === 'ArrowDown' ? 'first' : 'last')
        },
    }

    const list = {
        id: menuId,
        role: 'menu',
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
            const next =
                event.key === 'ArrowDown'
                    ? (at + 1) % listed.length
                    : event.key === 'ArrowUp'
                      ? (at <= 0 ? listed.length : at) - 1
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? listed.length - 1
                          : typedTo(event, listed, at)
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

    // 50.40 — a printable key moves focus to the next item whose text starts with what was typed.
    function typedTo(
        event: KeyboardEvent,
        listed: HTMLElement[],
        at: number,
    ): number {
        if (
            event.key.length !== 1 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
        )
            return -1
        const now = event.timeStamp
        typed =
            now - typedAt > TYPED_FOR
                ? event.key.toLowerCase()
                : typed + event.key.toLowerCase()
        typedAt = now
        // A letter typed again walks the items starting with it; a word finds the first it starts.
        const from = typed.length === 1 ? at + 1 : Math.max(at, 0)
        for (let step = 0; step < listed.length; step += 1) {
            const index = (from + step) % listed.length
            const text = listed[index]?.textContent?.trim().toLowerCase() ?? ''
            if (text.startsWith(typed)) return index
        }
        return -1
    }

    return { trigger, menu: list, open }
}
