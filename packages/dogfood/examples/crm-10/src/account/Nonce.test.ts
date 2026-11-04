import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test("the page's own inline script carries the nonce its policy admits", async () => {
    await using app = await createApp()
    const page = await app.fetch(new Request('http://crm.invalid/account'))
    const policy = page.headers.get('content-security-policy') ?? ''
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
    expect(nonce).toBeString()
    expect(await page.text()).toContain(
        `<script nonce="${nonce}">window.dataLayer`,
    )
})
