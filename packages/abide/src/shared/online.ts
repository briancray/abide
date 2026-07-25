// online() — a reactive connectivity boolean (CO2.5) for driving offline UI. On the client it
// tracks `navigator.onLine` through an M1 state updated by the `online`/`offline` window events,
// so reading it inside a reactive context re-runs on connectivity change. On the server there is
// no browser connectivity notion, so it is always true.

import { isBrowser } from './internal/isBrowser.ts'
import { type State, state } from './internal/reactive.ts'

let onlineState: State<boolean> | undefined

function ensureOnlineState(): State<boolean> {
    if (onlineState === undefined) {
        const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator
        const cell = state(nav?.onLine ?? true)
        onlineState = cell
        const win = globalThis as unknown as {
            addEventListener?: (type: string, handler: () => void) => void
        }
        win.addEventListener?.('online', () => cell.set(true))
        win.addEventListener?.('offline', () => cell.set(false))
    }
    return onlineState
}

export function online(): boolean {
    if (!isBrowser) return true
    return ensureOnlineState()()
}
