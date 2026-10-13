// 38.88, 38.92 — THE MENUS A LAYOUT OR A PAGE ADDS TO A DESKTOP APP'S MENU BAR, filed while it
// stands. Called in its `<script>`, so the menus are a function of its state: what `read` reads moving
// tells the window again, and the component going takes them with it. Outside a desktop app's window
// there is no menu bar, and nothing is filed.

import { menuBridge } from './menuBridge.ts'
import type { MenuItem } from './menuItem.ts'
import { watch } from './reactive/index.ts'

/** One `onMenu`'s menus, as it last answered, and whether its component has gone. */
type Filed = { menus: MenuItem[]; gone: boolean }

// IN THE ORDER FILED, which is outermost first: a layout's setup runs before the page inside it.
let filed: Filed[] = []
let telling = false

/** Files the menus `read` answers for as long as the calling component stands; returns what unfiles them. */
export function onMenu(read: () => readonly MenuItem[]): () => void {
    if (menuBridge() === undefined) return () => {}
    const entry: Filed = { menus: [], gone: false }
    filed.push(entry)
    const stop = watch(() => {
        entry.gone = false
        entry.menus = [...read()]
        tell()
        // A rerun files again at once; a component that went stays gone.
        return () => {
            entry.gone = true
            tell()
        }
    })
    // 12.8 — a `read` that threw stopped the watch with no cleanup to run, so the unfiling is
    // done here too.
    return () => {
        stop()
        entry.gone = true
        tell()
    }
}

// ONCE PER TURN, after every rerun and every component a navigation took has settled.
function tell(): void {
    if (telling) return
    telling = true
    queueMicrotask(async () => {
        telling = false
        const standing: Filed[] = []
        const menus: MenuItem[] = []
        for (const entry of filed) {
            if (entry.gone) continue
            standing.push(entry)
            menus.push(...entry.menus)
        }
        filed = standing
        const { reportMenu } = await import('./reportMenu.ts')
        reportMenu(menus)
    })
}
