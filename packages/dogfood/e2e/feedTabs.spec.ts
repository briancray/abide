// 18.11 — A WRITE ONE TAB MAKES REACHES THE OTHER TABS: the feed is a `global` value a `GET` serves,
// a `POST` patches it on the server, and every subscriber is sent what the patch wrote.
//
// THE REVERT: skip sending a patch to a subscription; the other tab keeps the old feed.
import { expect, test } from '@playwright/test'

const PAGE = 'guide/make-it-live'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('an entry one tab logs reaches the other tab', async ({ browser }) => {
    const context = await browser.newContext()
    const first = await context.newPage()
    const second = await context.newPage()
    const errors: string[] = []
    for (const page of [first, second])
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await first.goto(underMount(PAGE), { waitUntil: 'networkidle' })
    await second.goto(underMount(PAGE), { waitUntil: 'networkidle' })
    const card = (page: typeof first) =>
        page.locator('#crm-05-live-feed .ex-render')
    const feed = (page: typeof first) =>
        card(page).locator('ul.fields').innerText()
    const before = await feed(second)
    // An entry is stamped to the second, so a click a second on is a feed that reads differently.
    await first.waitForTimeout(1100)
    await card(first).getByRole('button', { name: 'Log a call' }).click()
    await expect.poll(() => feed(first)).not.toBe(before)
    await expect.poll(() => feed(second)).toBe(await feed(first))
    expect(errors).toEqual([])
    await context.close()
})
