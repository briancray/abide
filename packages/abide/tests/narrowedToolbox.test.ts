// 44.17 — A TOOLBOX A PROVIDER NARROWED IS THE TURN'S TOOLBOX: Claude Code's MCP requests are answered
// from its own `list` and `call`, so a provider wrapping `provider.claudeCode` with the tools it chose
// hands the model those tools alone. THE REVERT: throw in `forwardOf` for a toolbox `assistant` did not
// build, as it did, and every request here fails rather than answering.

import { expect, test } from 'bun:test'

import { forwardOf } from '../src/server/assistant.ts'
import type { Toolbox } from '../src/server/assistant.ts'

const called: unknown[] = []
const narrowed: Toolbox = {
    list: [
        {
            name: 'get_docs_search',
            description: 'Searches the docs.',
            inputSchema: { type: 'object' },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
            },
            outputSchema: undefined,
        },
    ],
    async call(name, input) {
        called.push({ name, input })
        return { content: [{ type: 'text', text: 'found' }], failed: false }
    },
}

test('a narrowed toolbox lists its own tools and answers its own calls — 44.17', async () => {
    const forward = forwardOf(narrowed)
    expect(await forward('tools/list', {})).toEqual({
        result: { tools: narrowed.list },
    })
    expect(
        await forward('tools/call', {
            name: 'get_docs_search',
            arguments: { query: 'watch' },
        }),
    ).toEqual({
        result: { content: [{ type: 'text', text: 'found' }], isError: false },
    })
    expect(called).toEqual([
        { name: 'get_docs_search', input: { query: 'watch' } },
    ])
})

test('a tool the narrowed toolbox does not list is not called — 44.17', async () => {
    called.length = 0
    const reply = await forwardOf(narrowed)('tools/call', {
        name: 'post_contacts_delete',
    })
    expect('error' in reply).toBe(true)
    expect(called).toEqual([])
})

test('the protocol around a narrowed toolbox is still answered', async () => {
    const reply = await forwardOf(narrowed)('initialize', {})
    expect('result' in reply).toBe(true)
})
