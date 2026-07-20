import { expect, test } from '@playwright/test'

// Multipart upload (#8): the browser calls the upload RPC with a real FormData — the SAME callable as
// on the server. The `files` schema guards the File; the JSON `input` schema guards the multipart
// TEXT `caption` field (#8 follow-up). Drives the real end-to-end validation path in a real browser.

const TEXT_FILE = { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world') }

test('a valid multipart upload (file + caption) succeeds from the browser', async ({ page }) => {
    await page.goto('/uploads')

    await page.getByTestId('upload-caption').fill('my sunset')
    await page.getByTestId('upload-file').setInputFiles(TEXT_FILE)
    await page.getByTestId('upload-submit').click()

    const result = page.getByTestId('upload-result')
    await expect(result).toBeVisible()
    await expect(result).toContainText('note.txt')
    await expect(result).toContainText('my sunset')
})

test('a valid file with an EMPTY caption is rejected by the input schema (#8 text-field follow-up)', async ({
    page,
}) => {
    await page.goto('/uploads')

    // Provide a valid file but leave the required text field empty → the TEXT validation (not the file
    // validation) fails. Proves the multipart `input` schema now governs text fields too.
    await page.getByTestId('upload-file').setInputFiles(TEXT_FILE)
    await page.getByTestId('upload-submit').click()

    await expect(page.getByTestId('upload-error')).toBeVisible()
    await expect(page.getByTestId('upload-result')).toHaveCount(0)
})
