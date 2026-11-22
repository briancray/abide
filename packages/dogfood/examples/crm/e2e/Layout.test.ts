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

// 35.20, 35.21, 35.23 — THE TOOLBAR A COMPANY FILLS IS ADOPTED WHERE THE SERVER WROTE IT AND MOVED
// INTO THE HEADER, and leaves with the company: on a direct hit hydration finds the hidden button
// where the page wrote it, with no warning that the client and the server disagree, the browser
// moves it into the header and shows it, and the list it navigates back to holds none.
// THE REVERT: drop the `element.remove()` in `outlet.into`'s `Disposer`, and the list keeps the
// company's button.
test("a company's toolbar action moves into the header and leaves with the company", async ({
    page,
}) => {
    const mismatches: string[] = []
    page.on('console', (message) => {
        if (message.text().includes('abide:hydrate'))
            mismatches.push(message.text())
    })
    await page.goto('companies/hopper-and-co', { waitUntil: 'networkidle' })
    const toolbar = page.locator('header')
    await expect(
        toolbar.getByRole('button', { name: 'Print sheet' }),
    ).toBeVisible()
    expect(mismatches).toEqual([])
    await page.getByRole('link', { name: 'All companies', exact: true }).click()
    await expect(page).toHaveURL('companies')
    await expect(page.getByRole('button', { name: 'Print sheet' })).toHaveCount(
        0,
    )
})
