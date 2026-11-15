import { expect, test } from '@playwright/test'

test('a failed call is reported from its trace, and the report is what was shown', async ({
    page,
}) => {
    // Relative, so it reaches /ops below whatever base the run serves.
    await page.goto('ops')
    const section = page
        .locator('main')
        .locator('.row', { hasText: 'Report this' })
    const fields = section.locator('xpath=following-sibling::ul[1]')
    await section
        .getByRole('button', { name: 'Email Grace her statement' })
        .click()
    await expect(fields.locator('strong').first()).toHaveText(/^[0-9a-f]{32}$/)
    const trace = await fields.locator('strong').first().textContent()
    await section.getByRole('button', { name: 'Report this' }).click()
    const dialog = page.locator('dialog.abide-report')
    await expect(dialog).toBeVisible()
    const summary = `Statements do not send ${Date.now()}`
    await dialog.getByLabel('What went wrong').fill(summary)
    // Every word that is sent, shown before it is.
    await expect(dialog.locator('pre')).toContainText(`## ${summary}`)
    await expect(dialog.locator('pre')).toContainText(`- traces: ${trace}`)
    await dialog.getByRole('button', { name: 'Send' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(fields.locator('strong').nth(1)).toContainText(summary)
})
