import { expect, test } from '@playwright/test'

test('the assistant fills the draft, and the person reviews it before sending', async ({
    page,
}) => {
    await page.goto('ops')
    const row = page.locator('main .row', { hasText: 'Ask the assistant' })
    const summary = row.locator('xpath=following-sibling::ul[1]//strong')
    await row.getByRole('button', { name: 'Email Grace her statement' }).click()
    await expect(
        row.getByRole('button', { name: 'Ask the assistant' }),
    ).toBeEnabled()
    await row.getByRole('button', { name: 'Ask the assistant' }).click()
    await expect(summary).toHaveText('Statements do not send')
    await row.getByRole('button', { name: 'Review and send' }).click()
    const dialog = page.locator('dialog.abide-report')
    await expect(dialog.getByLabel('What went wrong')).toHaveValue(
        'Statements do not send',
    )
    await expect(dialog.locator('pre')).toContainText('was refused. Trace ')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
})
