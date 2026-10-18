import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('off the tool list, and still answering on its address', async () => {
    await using app = await createApp()
    const listing = await app.fetch(
        new Request('http://crm.invalid/__abide/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            }),
        }),
    )
    const { tools } = (await listing.json()).result
    const names = tools.map((tool: { name: string }) => tool.name)
    expect(names).toContain('get_assistant_searchContacts')
    expect(names).not.toContain('get_assistant_exportContacts')
    const called = await app.fetch(
        new Request('http://crm.invalid/assistant/exportContacts'),
    )
    expect(called.status).toBe(200)
})
