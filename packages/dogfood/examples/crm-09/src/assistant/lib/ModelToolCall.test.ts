import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

const TOOL = 'get_assistant_searchContacts'

test('a model lists the handler as a tool, and calls it', async () => {
    await using app = await createApp()
    const ask = async (method: string, params: object) => {
        const answer = await app.fetch(
            new Request('http://crm.invalid/__abide/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            }),
        )
        return (await answer.json()).result
    }
    const { tools } = await ask('tools/list', {})
    const tool = tools.find((each: { name: string }) => each.name === TOOL)
    expect(tool.description).toBe('The contacts whose name contains `name`.')
    const called = await ask('tools/call', {
        name: TOOL,
        arguments: { name: 'Hopper' },
    })
    expect(JSON.parse(called.content[0].text)).toEqual([
        { id: 'c2', name: 'Grace Hopper', company: 'Hopper & Co' },
    ])
})
