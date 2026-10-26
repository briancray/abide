import { expect, test } from '@playwright/test'

test('a call logged offline waits, then is saved once', async ({
    page,
    context,
}) => {
    // Relative, so it reaches /ops below whatever base the run serves.
    await page.goto('ops')
    const log = page.locator('main')
    await expect(log.getByText('Wants a quote by Friday.')).toBeVisible()
    const note = `Sent the quote at ${Date.now()}`
    const tiles = log
        .locator('.tiles', { hasText: 'waiting' })
        .locator('strong')
    await context.setOffline(true)
    try {
        await log.getByPlaceholder('What Grace said').fill(note)
        await log.getByRole('button', { name: 'Log call' }).click()
        await expect(log.getByText(note)).toBeVisible()
        await expect(tiles).toHaveText(['1', 'not yet'])
    } finally {
        await context.setOffline(false)
    }
    await expect(tiles).toHaveText(['0', 'yes'])
    await expect(log.getByText(note)).toHaveCount(1)
    const saved = await page.request.get('ops/listCalls')
    const notes = ((await saved.json()) as { note: string }[]).map(
        (call) => call.note,
    )
    expect(notes.filter((each) => each === note)).toEqual([note])
})
