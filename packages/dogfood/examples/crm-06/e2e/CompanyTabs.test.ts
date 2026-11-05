import { expect, test } from '@playwright/test'

test('a tab moves the address, and the draft stays', async ({ page }) => {
    // Relative, so it reaches /companies below whatever base the run serves.
    await page.goto('companies/hopper-and-co', { waitUntil: 'networkidle' })
    const draft = page.getByPlaceholder('Follow up on Friday')
    await draft.fill('Ask Grace about the renewal')
    await page.getByRole('button', { name: 'notes', exact: true }).click()
    await expect(page).toHaveURL('companies/hopper-and-co?tab=notes')
    await expect(
        page.getByRole('button', { name: 'notes', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(draft).toHaveValue('Ask Grace about the renewal')
})
