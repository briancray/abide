// 26.24 — A SIGN-IN IN ONE TAB REACHES EVERY TAB OF THE BROWSER: the tab whose call signed in reloads its
// principal on the answer's `abide-principal`, and tells the others over a `BroadcastChannel`, each
// reloading from the cookie they share. THE REVERT: drop the `postMessage` in `PRINCIPAL_ROTATED`; the
// second tab still reads `no`.
import { expect, test } from '@playwright/test'

const PAGE = 'guide/decide-who-sees-what'

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
    // The sign-in card: the page carries other cards that read the principal beside it.
    const card = (page: typeof first) =>
        page.locator('#crm-07-sign-in .ex-render')
    // The card's one button reads which side of a sign-in the tab is on.
    const button = (page: typeof first) => card(page).getByRole('button')
    await expect(button(second)).toHaveText('Sign in')
    await button(first).click()
    await expect(button(first)).toHaveText('Sign out')
    await expect(button(second)).toHaveText('Sign out')
    await button(first).click()
    await expect(button(second)).toHaveText('Sign in')
    await context.close()
})
