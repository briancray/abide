import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// Drives /memo/global: the app-wide probes/verbs — reachable(host), online(), and the tag selectors
// invalidate({tags}) / refresh({tags}) that act across every slot carrying a tag.

async function intOf(page: Page, testId: string): Promise<number> {
    const text = (await page.getByTestId(testId).textContent()) ?? ''
    return Number.parseInt(text, 10)
}

test('reachable(host) reports a live host reachable and a dead port unreachable', async ({
    page,
}) => {
    await page.goto('/memo/global')

    await page.getByTestId('reach-start').click()
    await expect(page.getByTestId('reach-self')).toHaveText('true')
    await expect(page.getByTestId('reach-dead')).toHaveText('false')
})

test('online() reads true in a connected browser', async ({ page }) => {
    await page.goto('/memo/global')
    await expect(page.getByTestId('online-value')).toHaveText('true')
})

test('global invalidate({tags}) drops BOTH tagged reads together', async ({ page }) => {
    await page.goto('/memo/global')

    await page.getByTestId('tags-load').click()
    await expect(page.getByTestId('tags-a')).toHaveText(/^\d+$/, { timeout: 5000 })
    const a1 = await intOf(page, 'tags-a')
    const b1 = await intOf(page, 'tags-b')

    await page.getByTestId('tags-bust').click()
    await expect.poll(() => intOf(page, 'tags-a'), { timeout: 5000 }).toBeGreaterThan(a1)
    await expect(page.getByTestId('tags-b')).not.toHaveText(String(b1))
    expect(await intOf(page, 'tags-b')).toBeGreaterThan(b1)
})

test('global tag probes — pending({tags}) and refreshing({tags}) reflect a tagged shared slot', async ({
    page,
}) => {
    await page.goto('/memo/global')

    await page.getByTestId('tp-run').click()
    // pending({tags}) is true while the tagged shared slot first loads, false once settled.
    await expect(page.getByTestId('tp-pending-load')).toHaveText('true', { timeout: 15_000 })
    await expect(page.getByTestId('tp-pending-after')).toHaveText('false')
    // refreshing({tags}) is true while it revalidates over the retained value, false once settled.
    await expect(page.getByTestId('tp-refreshing-load')).toHaveText('true')
    await expect(page.getByTestId('tp-refreshing-after')).toHaveText('false')
})

test('global refresh({tags}) eagerly revalidates BOTH tagged reads', async ({ page }) => {
    await page.goto('/memo/global')

    await page.getByTestId('tags-refresh-load').click()
    await expect(page.getByTestId('tags-refresh-a')).toHaveText(/^\d+$/, { timeout: 5000 })
    const a1 = await intOf(page, 'tags-refresh-a')

    await page.getByTestId('tags-refresh').click()
    await expect.poll(() => intOf(page, 'tags-refresh-a'), { timeout: 5000 }).toBeGreaterThan(a1)
})
