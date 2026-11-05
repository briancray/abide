import { expect, test } from '@playwright/test'

test('a company opens inside the layout, and the note stays', async ({
    page,
}) => {
    // Relative, so it reaches /companies below whatever base the run serves.
    await page.goto('companies', { waitUntil: 'networkidle' })
    const note = page.getByPlaceholder('Note for the call')
    await note.fill('Grace wants a quote')
    await page.getByRole('link', { name: 'Hopper & Co', exact: true }).click()
    await expect(page).toHaveURL('companies/hopper-and-co')
    await expect(page.getByRole('heading', { name: 'Hopper & Co' })).toHaveText(
        'Hopper & Co',
    )
    await expect(note).toHaveValue('Grace wants a quote')
    await page.getByRole('link', { name: 'All companies', exact: true }).click()
    await expect(page).toHaveURL('companies')
    await expect(note).toHaveValue('Grace wants a quote')
})
