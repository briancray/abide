import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test("a page admits the app's own scripts, and no other origin's", async () => {
    await using app = await createApp()
    const page = await app.fetch(new Request('http://crm.invalid/account'))
    const policy = page.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain('widget.example')
})
