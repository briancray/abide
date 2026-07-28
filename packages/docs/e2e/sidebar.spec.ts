import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// The sidebar's per-page card index is built client-side from the rendered `section.sample[id]` cards.
// REGRESSION: it used to be built from a `bind:element` attachment assumed to re-fire per navigation. It
// does not — the root layout survives a cross-route soft-nav (only the diverging suffix is swapped), so
// after navigating, the sidebar kept showing the PREVIOUS page's cards, anchored under the previous link.
// A hard reload hid the bug, which is why it survived. The rebuild now hangs off `route()`.

async function sampleIndex(page: Page) {
    return page.evaluate(() => {
        const sub = document.querySelector('.idx-samples')
        return {
            blocks: document.querySelectorAll('.idx-samples').length,
            anchoredUnder: sub?.previousElementSibling?.textContent?.trim() ?? null,
            links: Array.from(sub?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href')),
        }
    })
}

test('the card index follows a soft-nav to the destination page', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('h1')).toContainText('memo')
    await expect.poll(async () => (await sampleIndex(page)).anchoredUnder).toBe('memo — loaded')

    await page.locator('aside.sidebar').getByRole('link', { name: 'state — owned' }).click()
    await expect(page).toHaveURL(/\/state$/)
    await expect(page.locator('h1')).toContainText('state')

    // The index must re-anchor under the NEW active link and list the NEW page's cards.
    await expect.poll(async () => (await sampleIndex(page)).anchoredUnder).toBe('state — owned')
    const after = await sampleIndex(page)
    expect(after.links).toEqual(['#state', '#transform', '#shared'])
    expect(after.blocks).toBe(1) // exactly one block — never a stale one left behind
})

test('a soft-nav to a page with no cards leaves no stale index', async ({ page }) => {
    await page.goto('/memo')
    await expect.poll(async () => (await sampleIndex(page)).blocks).toBe(1)

    // The RPC hub is prose and links only — no `.sample` cards at all — so the correct result is NO
    // index block, the case an early return used to skip, stranding the previous page's list.
    await page
        .locator('aside.sidebar')
        .getByRole('link', { name: 'rpc = memo + transport' })
        .click()
    await expect(page).toHaveURL(/\/rpc$/)
    await expect.poll(async () => (await sampleIndex(page)).blocks).toBe(0)
})
