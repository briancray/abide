// 38.90, 38.91 — WHAT A PICK DOES, in the page that told the window its menus: the window names the
// item by the id the report gave it, an `href` navigates, and a `menuItem` runs every function its
// `on` filed. The window's end is `webkit.messageHandlers.abideMenu`, stood in for by a recorder;
// 38.89's roles are AppKit's responder chain and have no page end to test here.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { CURRENT_ROUTER } from '#shared/CURRENT_ROUTER.ts'
import { menuItem } from '#shared/menuItem.ts'
import { reportMenu } from '#shared/reportMenu.ts'

const navigated: string[] = []

const told: string[] = []
const reported: unknown[] = []
const reportError = globalThis.reportError

beforeAll(() => {
    ;(globalThis as { webkit?: unknown }).webkit = {
        messageHandlers: {
            abideMenu: { postMessage: (message: string) => told.push(message) },
        },
    }
    // The page's router, recording where a pick sends it.
    CURRENT_ROUTER.current = {
        go: (to: URL | string) => {
            navigated.push(String(to))
            return Promise.resolve()
        },
    } as unknown as typeof CURRENT_ROUTER.current
    // A browser's `reportError` dispatches and returns; the emulator's throws.
    globalThis.reportError = (thrown: unknown) => void reported.push(thrown)
})

afterAll(() => {
    delete (globalThis as { webkit?: unknown }).webkit
    globalThis.reportError = reportError
    CURRENT_ROUTER.current = null
})

// The id the last report gave the item labelled `label`.
function idOf(label: string): number {
    const walk = (
        items: { label?: string; id?: number; items?: unknown[] }[],
    ): number | undefined => {
        for (const item of items) {
            if (item.label === label && item.id !== undefined) return item.id
            const inner = item.items && walk(item.items as never)
            if (inner !== undefined) return inner
        }
        return undefined
    }
    return walk(JSON.parse(told.at(-1) as string)) as number
}

const pick = (label: string) =>
    dispatchEvent(new CustomEvent('abide:menu', { detail: idOf(label) }))

// THE REVERTS: drop the `try` around each answer in `MenuEntry.pick`; the throw stops the rest and
// `ran` reads ['first']. Drop the `href` arm from the listener; `navigated` stays empty.
test('a pick runs every function its item filed, a throw stopping none, and an href navigates — 38.90, 38.91', () => {
    const won = menuItem({ label: 'Mark won' })
    const ran: string[] = []
    won.on(() => ran.push('first'))
    won.on(() => {
        throw new Error('the tracker is down')
    })
    won.on(() => ran.push('last'))
    reportMenu([
        {
            label: 'Deal',
            items: [won, { label: 'Pipeline', href: '/pipeline' }],
        },
    ])
    pick('Mark won')
    expect(ran).toEqual(['first', 'last'])
    expect(reported).toHaveLength(1)
    pick('Pipeline')
    expect(navigated).toEqual(['/pipeline'])
})
