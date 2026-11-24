import { expect, test } from '@playwright/test'

const SHARED = 'Pipelines can now be shared with a link.'
const FORECASTS = 'Forecasts lock at the end of each quarter.'

// 50.69, 50.17 — A CLOSED ANNOUNCEMENT STAYS CLOSED ON THE NEXT VISIT, and the server's render is
// the one that leaves it out: the cookie is read as the page is written, so it never paints to be
// taken down. THE REVERT: build `announcements` without its `store`, and the reload shows it again.
test('a closed announcement is gone from the next page the server renders', async ({
    page,
}) => {
    await page.goto('companies', { waitUntil: 'networkidle' })
    const banner = page.getByRole('status', { name: 'Announcements' })
    await expect(banner.getByRole('listitem')).toHaveCount(2)
    await expect(banner).toContainText(SHARED)
    await banner
        .getByRole('listitem')
        .filter({ hasText: SHARED })
        .getByRole('button', { name: 'Dismiss' })
        .click()
    await expect(banner.getByRole('listitem')).toHaveCount(1)

    const written = await (await page.request.get('companies')).text()
    expect(written).not.toContain(SHARED)
    expect(written).toContain(FORECASTS)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(banner.getByRole('listitem')).toHaveCount(1)
    await expect(banner).toContainText(FORECASTS)
})
