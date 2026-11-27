// 26.24 — A SIGN-IN IN ONE TAB REACHES EVERY TAB OF THE BROWSER: the tab whose call signed in refreshes
// everything it reads on the answer's `abide-principal`, and tells the others over a
// `BroadcastChannel`, each refreshing from the cookie they share — its principal, and a contact card
// that never names the sign-in, painted settled by the server. THE REVERTS: drop the `postMessage`
// in `principalRotated`, and the second tab's button still reads `Sign in`; drop
// `refreshCallerHeld()` from `rotated`, and the first tab's does; drop `answeredAtOnce()` from `answerOf`,
// and the contact card still reads `admins only` where Maya, an admin, signed in.
import { expect, test } from '@playwright/test'

// The CRM's account page, served at its own address (40.24).
const PAGE = 'account'

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
    // The sign-in, under its heading: its one button reads which side of a sign-in the tab is on.
    const button = (page: typeof first) =>
        page
            .getByRole('heading', { name: 'Sign in', exact: true })
            .locator('xpath=following-sibling::div[1]')
            .getByRole('button')
    // The contact card's deal value, which only an admin reads.
    const dealValue = second
        .getByRole('heading', { name: 'A contact', exact: true })
        .locator('xpath=following-sibling::ul[1]')
        .locator('strong')
        .nth(1)
    await expect(button(second)).toHaveText('Sign in')
    await expect(dealValue).toHaveText('admins only')
    await button(first).click()
    await expect(button(first)).toHaveText('Sign out')
    await expect(button(second)).toHaveText('Sign out')
    await expect(dealValue).toHaveText('$34,000')
    await button(first).click()
    await expect(button(second)).toHaveText('Sign in')
    await expect(dealValue).toHaveText('admins only')
    await context.close()
})
