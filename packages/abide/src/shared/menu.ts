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
import { join } from './register.ts'
import { openingEnd, roving, typeahead } from './roving.ts'

/** Where a menu opens against its trigger, placed as a `popover` is, and what hears it open and close. */
export type MenuOptions = Omit<
    PopoverOptions,
    'align' | 'offset' | 'escape' | 'outside'
> & {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string
    /** Whether the menu is open: hand it a `Reactive` to read and write it, and every way it closes writes `false` back. */
    open?: Reactive<boolean>
    /** Which edge of the trigger the menu lines up with. Default `'start'`; a function is read at each placement. */
    align?: Live<'start' | 'center' | 'end'>
    /** Pixels between the trigger and the menu. Default `4`; a function is read at each placement. */
    offset?: Live<number>
    /** Milliseconds a mouse or pen rests on the trigger before the menu opens, or `false` for none. Off by default; a function is read live. */
    openOnHover?: Live<number | false>
    /** Milliseconds after the pointer leaves the trigger and the menu before a menu a pointer opened closes, or `false` for never. Off by default; a function is read live. */
    closeOnLeave?: Live<number | false>
    /** The menus sharing this name switch between each other: a pointer on another's trigger, or ArrowLeft and ArrowRight, opens it while one of them is open. A function is read live. */
    group?: Live<string | undefined>
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

// 50.57-50.59 — every menu standing, so a group finds its members: one list per request on a server, as
// every `reactive` without `global` is (11.32), and a menu is a member for as long as its setup stands.
type Member = {
    group(): string | undefined
    trigger(): HTMLElement | null
    isOpen(): boolean
    /** Whether focus is in its menu. */
    holdsFocus(): boolean
    switchTo(from: 'start' | 'end', focused: Focus, pointer: boolean): void
    /** Marks it leaving toward `to`, and closes it. */
    leaving(to: 'start' | 'end'): void
}
const members = reactive<readonly Member[]>([])

// Where focus goes as a menu opens: its first item, its last (50.28), or nowhere — a pointer opening
// it leaves focus where it was.
type Focus = 'first' | 'last' | 'none'

/** The members of `group` standing, in the document order of their triggers. */
function groupOf(group: string): Member[] {
    const found: Member[] = []
    for (const member of members.peek() ?? [])
        if (member.group() === group && member.trigger() !== null)
            found.push(member)
    return found.sort((a, b) =>
        (a.trigger() as HTMLElement).compareDocumentPosition(
            b.trigger() as HTMLElement,
        ) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
    )
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

    // Which item takes focus as the menu opens: the last where ArrowUp opened it (50.28), none where a
    // pointer resting on the trigger opened it.
    let focusOnOpen: Focus = 'first'
    // 50.58 — whether a pointer opened it, which alone a leave closes.
    let byPointer = false
    // 50.60 — the side the menu a group switched from stood on, and the side the one it switched to
    // stands on, for a transition to read.
    const cameFrom = reactive<'start' | 'end' | undefined>(undefined)
    const goingTo = reactive<'start' | 'end' | undefined>(undefined)
    let hovering: ReturnType<typeof setTimeout> | undefined
    let leaving: ReturnType<typeof setTimeout> | undefined
    const show = (focused: Focus, pointer: boolean): void => {
        const list = menuOf()
        if (list === null || list.matches(':popover-open')) return
        focusOnOpen = focused
        byPointer = pointer
        goingTo.set(undefined)
        list.showPopover()
    }
    const cancelLeave = (): void => {
        clearTimeout(leaving)
        leaving = undefined
    }
    // 50.58 — a menu a pointer opened closes once the pointer has been off its trigger and its menu
    // for `closeOnLeave` milliseconds; coming back onto either keeps it.
    const armLeave = (): void => {
        cancelLeave()
        if (!byPointer || !open.peek()) return
        const after = live(options.closeOnLeave)
        if (after === undefined || after === false) return
        leaving = setTimeout(hide, after)
    }

    // 50.59 — this menu among its group's: what opens it from a groupmate, and what marks it leaving.
    const self: Member = {
        group: () => live(options.group),
        trigger: triggerOf,
        isOpen: () => open.peek() === true,
        holdsFocus: () => menuOf()?.contains(document.activeElement) === true,
        switchTo: (from, focused, pointer) => {
            show(focused, pointer)
            cameFrom.set(from)
        },
        // Closed here rather than left to the next auto popover's opening, which closes it only where
        // the two menus are not one inside the other.
        leaving: (to) => {
            goingTo.set(to)
            hide()
        },
    }
    join(members, self)
    /** Opens `to` from the open groupmate `from`, each marked with the side the other stands on. */
    const switchIn = (to: Member, from: Member, focused: Focus): void => {
        // A pointer on a trigger is the one switch that comes here; the keys switch in the menu's own.
        const mates = groupOf(self.group() as string)
        const ahead = mates.indexOf(to) > mates.indexOf(from)
        from.leaving(ahead ? 'end' : 'start')
        to.switchTo(ahead ? 'start' : 'end', focused, true)
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
            if (focusOnOpen !== 'none') {
                const listed = items()
                listed[focusOnOpen === 'first' ? 0 : listed.length - 1]?.focus()
            }
            options.onopen?.()
            return
        }
        stop?.()
        stop = undefined
        cancelLeave()
        cameFrom.set(undefined)
        if (open.peek()) open.set(false)
        options.onclose?.()
    }

    // 50.37 — `open` written by the app opens and closes the popover.
    open.watch((wanted) => {
        if (typeof document === 'undefined') return
        const list = menuOf()
        if (list === null || list.matches(':popover-open') === wanted) return
        if (wanted) show('first', false)
        else hide()
    })

    const trigger = {
        id: triggerId,
        'data-menu': 'trigger',
        'aria-haspopup': 'menu',
        'aria-controls': menuId,
        get 'aria-expanded'() {
            return open() ? 'true' : 'false'
        },
        onpointerdown: () => {
            openAtPress = open.peek() === true
        },
        // A click from a key (Enter, Space) has no pointer under it, and `detail` 0 says so.
        onclick: (event: MouseEvent) => {
            if (open.peek() || openAtPress) hide()
            else show('first', event.detail !== 0)
            openAtPress = false
        },
        onkeydown: (event: KeyboardEvent) => {
            const end = openingEnd(event.key, 'vertical')
            if (end === undefined) return
            event.preventDefault()
            show(end, false)
        },
        // 50.57, 50.59 — a groupmate open switches to this one at once; else a resting mouse or pen
        // opens it after `openOnHover`. A touch has no hover, and a tap is a click.
        onpointerenter: (event: PointerEvent) => {
            cancelLeave()
            if (event.pointerType === 'touch' || open.peek()) return
            const group = self.group()
            if (group !== undefined) {
                const openMate = groupOf(group).find(
                    (mate) => mate !== self && mate.isOpen(),
                )
                if (openMate !== undefined) {
                    // Focus in the menu leaving goes to the one arriving, or it would fall to the page.
                    switchIn(
                        self,
                        openMate,
                        openMate.holdsFocus() ? 'first' : 'none',
                    )
                    return
                }
            }
            const after = live(options.openOnHover)
            if (after === undefined || after === false) return
            clearTimeout(hovering)
            hovering = setTimeout(() => show('none', true), after)
        },
        onpointerleave: () => {
            clearTimeout(hovering)
            hovering = undefined
            armLeave()
        },
    }

    const list = {
        id: menuId,
        role: 'menu',
        'data-menu': 'menu',
        popover: 'auto',
        'aria-labelledby': triggerId,
        get 'data-side'() {
            return placed()
        },
        get 'data-open'() {
            return open() ? '' : undefined
        },
        get 'data-from'() {
            return cameFrom()
        },
        get 'data-to'() {
            return goingTo()
        },
        ontoggle: toggled,
        onpointerenter: cancelLeave,
        onpointerleave: armLeave,
        onkeydown: (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                hide()
                triggerOf()?.focus()
                return
            }
            if (event.key === 'Tab') return hide()
            // 50.59 — ArrowLeft and ArrowRight open the groupmate before and after this one.
            const group = self.group()
            if (
                group !== undefined &&
                (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            ) {
                const mates = groupOf(group)
                const at = mates.indexOf(self)
                if (mates.length < 2 || at === -1) return
                event.preventDefault()
                const step = event.key === 'ArrowRight' ? 1 : -1
                const to = mates[(at + step + mates.length) % mates.length]
                self.leaving(step === 1 ? 'end' : 'start')
                ;(to as Member).switchTo(
                    step === 1 ? 'start' : 'end',
                    'first',
                    false,
                )
                return
            }
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
        // changes its state with the menu left open. CAPTURED, so the item is read as the click
        // found it: an item's own handler can disable the item it picked — a stage moved to is
        // the one no longer offered — and read after it, the pick is no item at all.
        onclick: {
            capture: true,
            handleEvent: (event: MouseEvent) => {
                if (!(event.target instanceof Element)) return
                const item = event.target.closest(ITEM)
                if (item === null) return
                if (item.getAttribute('role') !== 'menuitem') return
                hide()
                triggerOf()?.focus()
            },
        },
    }

    return { id: menuId, trigger, menu: list, open }
}
