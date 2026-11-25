// 50.28-50.32, 50.37-50.40, 50.57, 50.58 — A BUTTON AND THE ACTIONS IT OPENS: WAI-ARIA's menu button, as
// parts an app spreads onto elements of its own. The menu opens in a `popover` of its own (50.37): the
// popover places it, shows it and closes it on a press outside, and the menu is the keyboard over its
// items and what a pick does. Each part is the popover's with the menu's laid over it, so an app spreads
// one per element.

import { type Live, live } from './live.ts'
import { popoverLayer, type PopoverOptions } from './popover.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { join } from './register.ts'
import { openingEnd, roving, typeahead } from './roving.ts'
import { withPart } from './withPart.ts'

/** Where a menu opens and what opens and closes it, as a `popover` takes them, and the menus it switches between. */
export type MenuOptions = PopoverOptions & {
    /** The menus sharing this name switch between each other: a pointer on another's trigger, or ArrowLeft and ArrowRight, opens it while one of them is open. A function is read live. */
    group?: Live<string | undefined>
}

/** The parts `menu` hands back, each spread onto an element: `<button {...actions.trigger}>`. */
export type Menu = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The trigger's attributes and listeners: a button that opens and closes the menu, and that it is placed against. */
    readonly trigger: Record<string, unknown>
    /** An element the menu is placed against that does not open it, for a menu opened by writing `open`. */
    readonly anchor: Record<string, unknown>
    /** The menu's attributes and listeners; its children carrying a menu item role are its items. */
    readonly menu: Record<string, unknown>
    /** Whether the menu is open — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
}

// 50.57 — every menu standing, so a group finds its members: one list per request on a server, as
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

// Where focus goes as a menu opens: its first item, its last, or nowhere (50.28).
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

// 50.29 — the items the keys walk and a click picks.
const ITEM =
    ':is([role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]):not([disabled]):not([aria-disabled=true])'

/** WAI-ARIA's menu button: a trigger and the menu it opens, as parts to spread. */
export function menu(options: MenuOptions = {}): Menu {
    // 50.37 — the popover it opens in, under a menu's own placement defaults. Hydration runs setup again
    // (41.6), and every attribute naming one is bound to it, so the ids are rewritten together; the
    // popover's own check (49.7) covers every id the menu names.
    const layer = popoverLayer({
        ...options,
        id: options.id ?? `menu-${randomToken(4, 'hex')}`,
        align: () => live(options.align) ?? 'start',
        offset: () => live(options.offset) ?? 4,
    })
    const { open } = layer
    const menuId = layer.id
    const triggerId = layer.trigger.id as string
    const menuOf = () => document.getElementById(menuId)
    const triggerOf = () => document.getElementById(triggerId)
    const typedTo = typeahead()

    const items = (): HTMLElement[] => {
        const list = menuOf()
        return list === null
            ? []
            : [...list.querySelectorAll<HTMLElement>(ITEM)]
    }

    // Read as the popover opens, then put back: an opening nothing here asked for focuses as 50.28
    // has it for how the popover opened.
    let focusOnOpen: Focus | undefined
    // 50.58 — the side the menu a group switched from stood on, and the side the one it switched to
    // stands on, for a transition to read.
    const cameFrom = reactive<'start' | 'end' | undefined>(undefined)
    const goingTo = reactive<'start' | 'end' | undefined>(undefined)

    const isOpen = (): boolean => open.peek() === true
    const show = (focused: Focus, pointer: boolean): void => {
        if (isOpen()) return
        focusOnOpen = focused
        // 50.56 — a pointer switching menus opened this one, so a leave closes it.
        layer.show(pointer ? 'hover' : undefined)
    }
    const hide = (): void => {
        if (isOpen()) open.set(false)
    }
    // 50.31 — a pick or an Escape closes the menu and hands focus back to its trigger.
    const closeToTrigger = (): void => {
        hide()
        triggerOf()?.focus()
    }

    const self: Member = {
        group: () => live(options.group),
        trigger: triggerOf,
        isOpen,
        holdsFocus: () => menuOf()?.contains(document.activeElement) === true,
        switchTo: (from, focused, pointer) => {
            show(focused, pointer)
            cameFrom.set(from)
        },
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

    // The popover's own state is the truth: every way it opens or closes arrives here, its trigger, a
    // press outside and the app writing `open` as much as this menu's writes.
    const toggled = (event: Event): void => {
        if ((event as ToggleEvent).newState === 'open') {
            goingTo.set(undefined)
            const by = layer.openedBy()
            const focused =
                focusOnOpen ??
                (by === 'hover' || by === 'focus' ? 'none' : 'first')
            if (focused !== 'none') {
                const listed = items()
                listed[focused === 'first' ? 0 : listed.length - 1]?.focus()
            }
            focusOnOpen = undefined
            return
        }
        cameFrom.set(undefined)
    }

    // The popover's trigger with the menu's laid over it; a pointer entering is the popover's where
    // no groupmate is open.
    const rest = layer.trigger.onpointerenter as (event: PointerEvent) => void
    const trigger = withPart(withPart({}, layer.trigger), {
        'data-menu': 'trigger',
        'aria-haspopup': 'menu',
        // 50.32
        onkeydown: (event: KeyboardEvent) => {
            const end = openingEnd(event.key, 'vertical')
            if (end === undefined) return
            event.preventDefault()
            show(end, false)
        },
        // 50.57 — a groupmate open switches to this one at once; else the popover's rest (50.55).
        onpointerenter: (event: PointerEvent) => {
            const group = self.group()
            if (
                event.pointerType !== 'touch' &&
                !isOpen() &&
                group !== undefined
            ) {
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
            rest(event)
        },
    })

    // 50.38 — the popover's part with the menu's laid over it.
    const list = withPart(withPart({}, layer.popover), {
        'aria-labelledby': triggerId,
        role: 'menu',
        'data-menu': 'menu',
        get 'data-from'() {
            return cameFrom()
        },
        get 'data-to'() {
            return goingTo()
        },
        ontoggle: toggled,
        onkeydown: (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                // Kept from `dismissible`'s stack (53.14), which would close it and leave focus inside.
                event.preventDefault()
                closeToTrigger()
                return
            }
            if (event.key === 'Tab') return hide()
            // 50.57 — ArrowLeft and ArrowRight open the groupmate before and after this one.
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
                closeToTrigger()
            },
        },
    })

    return {
        id: menuId,
        trigger,
        anchor: withPart(withPart({}, layer.anchor), { 'data-menu': 'anchor' }),
        menu: list,
        open,
    }
}
