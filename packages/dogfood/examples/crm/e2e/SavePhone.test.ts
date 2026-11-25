import { expect, test } from '@playwright/test'

// 48.1 — THE REPORT A REFUSAL'S TOAST OFFERS HOLDS THE TRACE OF THE CALL THAT FAILED, read off the
// refusal itself. THE REVERT: open `report()` from the toast's action — the preview names no trace.
test("a refused save's report holds the trace of the call that failed", async ({
    page,
}) => {
    // Relative, so it reaches /contacts below whatever base the run serves.
    await page.goto('contacts')
    const row = page.locator('main').locator('.row', { hasText: "Ada's phone" })
    await row.getByLabel("Ada's phone").fill('12')
    await row.getByRole('button', { name: 'Save' }).click()
    await page.locator('[data-notices=action]', { hasText: 'Report' }).click()
    const dialog = page.locator('dialog.abide-report')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('pre')).toContainText(/- traces: [0-9a-f]{32}/)
})
