// 38.88, 38.92 — `onMenu`, in a mounted page: what the window is told, and how often. The window's
// end is `webkit.messageHandlers.abideMenu`, stood in for here by a recorder, so every report is a
// call counted — the contract is "tells the window once per turn", which the menus alone cannot show.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { flushSync, reactive } from '#shared'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// What the page reads, made here so the test writes it: a name the page binds would be lowered to
// its value (31.1) on its way out to the test.
const STATE = { label: reactive('Open'), shown: reactive(true) }

// The page's menu outermost, the component it invokes inside it — as a layout's setup runs before
// the page it holds, a parent's runs before its child's.
const PAGE = `<script>
import { onMenu } from '@abide/abide'
import Inner from './Inner.abide'

const state = (globalThis as { menuState: { label: () => string; shown: () => boolean } }).menuState
onMenu(() => [{ label: 'Outer', items: [{ label: state.label() }] }])
</script>

<main>{#if state.shown()}<Inner/>{/if}</main>`

const INNER = `<script>
import { onMenu } from '@abide/abide'

onMenu(() => [{ label: 'Inner' }])
</script>

<p>inner</p>`

const told: string[] = []

// The labels of each report, its menus in the order told.
function labels(report: string): string[] {
    const found: string[] = []
    for (const menu of JSON.parse(report) as { label: string }[])
        found.push(menu.label)
    return found
}

// Until a report beyond `count` arrives, then a few turns more, so a second one has its chance.
async function reported(count: number): Promise<void> {
    for (let turn = 0; turn < 200 && told.length <= count; turn += 1)
        await Bun.sleep(5)
    await Bun.sleep(20)
}

beforeAll(async () => {
    ;(globalThis as { menuState?: unknown }).menuState = STATE
    // Rendered on the server with no window, so nothing is filed until the mount below.
    const { mount } = await renderPage(PAGE, { Inner: INNER })
    ;(globalThis as { webkit?: unknown }).webkit = {
        messageHandlers: {
            abideMenu: { postMessage: (message: string) => told.push(message) },
        },
    }
    mount()
})

afterAll(() => {
    delete (globalThis as { webkit?: unknown }).webkit
})

// THE REVERTS: drop the `telling` guard in `onMenu`'s `tell`, and the mount's two filings report
// twice — the count reads 2 where 1 is due; `unshift` the filing rather than `push` it, and the
// report reads `['Inner', 'Outer']`.
test('a mount tells the window once, its menus outermost first — 38.88, 38.92', async () => {
    await reported(0)
    expect(told.length).toBe(1)
    expect(labels(told[0] as string)).toEqual(['Outer', 'Inner'])
})

// THE REVERTS: run `onMenu`'s body once, untracked, in place of its `watch`; the writes tell the
// window nothing, and the count reads 1 where 2 is due. Drop the `telling` guard, and the two writes
// in one turn report twice: 4 where 3 is due.
test('a write to what onMenu read tells the window again, once a turn — 38.92', async () => {
    const before = told.length
    STATE.label.set('Save')
    STATE.label.set('Save as')
    flushSync()
    await reported(before)
    expect(told.length).toBe(before + 1)
    const [outer] = JSON.parse(told.at(-1) as string) as {
        items: { label: string }[]
    }[]
    expect(outer?.items[0]?.label).toBe('Save as')
})

// THE REVERT: drop the disposer `onMenu`'s watch returns (`entry.gone = true; tell()`); the inner
// component's scope stops and nothing is told — the count reads 2 where 3 is due, and the window
// keeps `Inner`.
test('a component unmounted takes its menus with it — 38.88, 38.92', async () => {
    const before = told.length
    STATE.shown.set(false)
    flushSync()
    await reported(before)
    expect(told.length).toBe(before + 1)
    expect(labels(told.at(-1) as string)).toEqual(['Outer'])
})
