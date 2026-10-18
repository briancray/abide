import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

// A request from one browser: the cookie a page is handed on its first visit.
function fromPage(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
): Request {
    return new Request(`http://crm.invalid${path}`, {
        ...init,
        headers: {
            ...init.headers,
            cookie: 'abide-caller=one-browser',
            accept: 'application/jsonl',
        },
    })
}

test('unpaired: asking is refused, the bridge shows a command', async () => {
    await using app = await createApp()
    const refused = await app.fetch(
        fromPage('/assistant/askClaudeCode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: 'user', content: 'Which company is Grace at?' },
                ],
            }),
        }),
    )
    expect(refused.status).toBe(409)
    const watching = new AbortController()
    const status = await app.fetch(
        fromPage('/assistant/bridge', { signal: watching.signal }),
    )
    const reader = (status.body as ReadableStream<Uint8Array>).getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    watching.abort()
    const { paired, command } = JSON.parse(first.split('\n')[0] ?? '')
    expect(paired).toBe(false)
    expect(command).toMatch(
        /^bunx @abide\/bridge@\S+ http:\/\/crm.invalid \S+$/,
    )
})
