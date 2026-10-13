// 38.88 — A ROUTE'S MENU, TOLD TO THE WINDOW IT IS SHOWN IN. Loaded only inside a desktop app, where
// the window has opened `abideMenu` to the page; anywhere else the router never imports it.

import { MenuEntry, type MenuItem } from '#shared/menuItem.ts'
import { navigate } from '#shared/navigate.ts'
import { menuBridge } from './menuBridge.ts'

/** A menu item as the window builds it: an item the page answers carries the `id` it is told by. */
type Told =
    | 'separator'
    | {
          label: string
          key: string | undefined
          role: string | undefined
          id: number | undefined
          items: Told[] | undefined
      }

// The items the last report numbered, by their `id`.
let numbered: Exclude<MenuItem, 'separator'>[] = []
let listening = false

/** Tells the window the menus `chain` exports, layouts outermost first and the page last. */
export function reportMenu(chain: { menu?: unknown }[]): void {
    const bridge = menuBridge()
    if (bridge === undefined) return
    numbered = []
    const told: Told[] = []
    for (const level of chain)
        if (Array.isArray(level.menu))
            for (const menu of level.menu as MenuItem[]) told.push(tell(menu))
    if (!listening) {
        listening = true
        // 38.90, 38.91 — the window names the item picked; the page does what it means.
        addEventListener('abide:menu', (event) => {
            const item = numbered[(event as CustomEvent<number>).detail]
            if (item === undefined) return
            if (item.href !== undefined) void navigate(item.href)
            if (item instanceof MenuEntry) item.pick()
        })
    }
    bridge.postMessage(JSON.stringify(told))
}

function tell(item: MenuItem): Told {
    if (item === 'separator') return item
    const answered = item.items === undefined && !('role' in item && item.role)
    const told: Told = {
        label: item.label,
        key: item.key,
        role: 'role' in item ? item.role : undefined,
        id: answered ? numbered.length : undefined,
        items: item.items?.map(tell),
    }
    if (answered) numbered.push(item)
    return told
}
