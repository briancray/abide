// 18.8, 18.11 — A BROWSER'S PATCH REACHES THE OTHER TABS OF ITS ROOM, and no other room: the ops go to
// the server, through the socket's own `patch`, and back to every subscriber as what it wrote.
//
// THE REVERT: skip the `patch` the mux makes for a `pub` frame; the other tab keeps the greeting.
import { expect, test } from '@playwright/test'

const ROOM = 'data/keep-a-room-of-callers-in-sync'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a turn one tab sends reaches the other tab of that browser, and not a stranger', async ({
    browser,
}) => {
    const mine = await browser.newContext()
    const stranger = await browser.newContext()
    const first = await mine.newPage()
    const second = await mine.newPage()
    const other = await stranger.newPage()
    const errors: string[] = []
    for (const page of [first, second, other])
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await first.goto(underMount(ROOM), { waitUntil: 'networkidle' })
    await second.goto(underMount(ROOM), { waitUntil: 'networkidle' })
    await other.goto(underMount(ROOM), { waitUntil: 'networkidle' })
    const said = (page: typeof first) => page.locator('ul.chat li p').last()
    await expect(said(first)).toHaveText('Ask about any invoice here.')
    await first.getByRole('button', { name: 'Send' }).click()
    await expect(said(first)).toHaveText('Is invoice 4021 paid yet?')
    await expect(said(second)).toHaveText('Is invoice 4021 paid yet?')
    await other.waitForTimeout(300)
    await expect(said(other)).toHaveText('Ask about any invoice here.')
    expect(errors).toEqual([])
})
