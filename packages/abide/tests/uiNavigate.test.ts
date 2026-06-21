import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { navigate } from '../src/lib/ui/navigate.ts'
import { historyEntries } from '../src/lib/ui/runtime/historyEntries.ts'

/* navigate writes to the `history` global (absent in Bun) and saves scroll off
   globalThis. Install capturing stubs for both, then restore them so the mini-dom
   router tests — which rely on `history` being undefined — are unaffected. */
type EntryState = { abideEntry: number }
const globals = globalThis as {
    history?: { state: EntryState | null; pushState: Function; replaceState: Function }
    scrollX?: number
    scrollY?: number
    scrollTo?: (x: number, y: number) => void
}
const previous = {
    history: globals.history,
    scrollX: globals.scrollX,
    scrollY: globals.scrollY,
    scrollTo: globals.scrollTo,
}

beforeAll(() => {
    globals.history = {
        state: null,
        pushState(state: EntryState) {
            this.state = state
        },
        replaceState(state: EntryState) {
            this.state = state
        },
    }
    globals.scrollX = 0
    globals.scrollY = 0
    globals.scrollTo = (x, y) => {
        globals.scrollX = x
        globals.scrollY = y
    }
})
afterAll(() => {
    globals.history = previous.history
    globals.scrollX = previous.scrollX
    globals.scrollY = previous.scrollY
    globals.scrollTo = previous.scrollTo
})

describe('navigate — history-entry identity + scroll capture', () => {
    test('a push stamps a fresh abideEntry id; replace keeps the current one', () => {
        navigate('/a')
        const first = (globals.history as { state: EntryState }).state.abideEntry
        expect(typeof first).toBe('number')

        navigate('/b')
        expect((globals.history as { state: EntryState }).state.abideEntry).toBe(first + 1)

        navigate('/b', true) // replace honouring a redirect — same history position
        expect((globals.history as { state: EntryState }).state.abideEntry).toBe(first + 1)
    })

    test('the outgoing scroll is bucketed before history moves, restorable on return', () => {
        navigate('/list')
        const list = (globals.history as { state: EntryState }).state.abideEntry
        globals.scrollTo?.(0, 320) // user scrolls the list

        navigate('/detail') // save() buckets `list` at [0, 320] before minting the next id
        globals.scrollTo?.(0, 0)

        historyEntries.adopt(list) // back to the list
        historyEntries.restore()
        expect(globals.scrollY).toBe(320)
    })
})
