// 26.24 — A SIGN-IN IN ONE TAB REACHES EVERY TAB OF THE BROWSER: the tab whose call signed in reloads its
// principal on the answer's `abide-principal`, and tells the others over a `BroadcastChannel`, each
// reloading from the cookie they share. THE REVERT: drop the `postMessage` in `PRINCIPAL_ROTATED`; the
// second tab still reads `no`.
import { expect, test } from '@playwright/test'

const PAGE = 'app/know-who-is-calling'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a sign-in in one tab reaches the other tabs of the browser — 26.24', async ({
    browser,
}) => {
    const context = await browser.newContext()
    const first = await context.newPage()
    const second = await context.newPage()
    await first.goto(underMount(PAGE), { waitUntil: 'networkidle' })
    await second.goto(underMount(PAGE), { waitUntil: 'networkidle' })
    // The card under "One seal, read everywhere": the page carries other sign-in cards beside it.
    const card = (page: typeof first) =>
        page
            .locator('section', {
                has: page.locator('#one-seal-read-everywhere'),
            })
            .locator('.ex-render')
    const signedIn = (page: typeof first) =>
        card(page)
            .locator('ul.fields li', { hasText: 'signed in' })
            .locator('strong')
    await expect(signedIn(second)).toHaveText('no')
    await card(first).getByRole('button', { name: 'Sign in' }).click()
    await expect(signedIn(first)).toHaveText('yes')
    await expect(signedIn(second)).toHaveText('yes')
    await card(first).getByRole('button', { name: 'Sign out' }).click()
    await expect(signedIn(second)).toHaveText('no')
    await context.close()
})
