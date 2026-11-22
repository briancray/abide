import { afterEach, expect, test } from 'bun:test'

import { type App, createApp } from '@abide/abide/server'
import { mount, settled } from '@abide/harness/abide'

import ClaudeCodeChat from './ClaudeCodeChat.abide'

const realFetch = globalThis.fetch
afterEach(() => {
    globalThis.fetch = realFetch
})

// The page's requests, answered by the app as one browser's.
function servedBy(app: App) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        app.fetch(
            input instanceof Request
                ? input
                : new Request(
                      new URL(String(input), 'http://crm.invalid/'),
                      init,
                  ),
            { caller: 'one-browser' },
        )) as typeof fetch
}

const step = () => document.querySelector('section')?.getAttribute('data-step')

test('unpaired: the command and the click, and no chat yet', async () => {
    await using app = await createApp()
    servedBy(app)
    using _chat = await mount(ClaudeCodeChat({}))
    await settled()
    expect(step()).toBe('click')
    expect(
        document.querySelector('[data-pairing=command]')?.textContent,
    ).toMatch(/^bunx @abide\/bridge@\S+ http:\/\/crm.invalid \S+$/)
    expect(document.querySelector('[data-pairing=pair]')?.textContent).toBe(
        'Pair with a click',
    )
    expect(document.querySelector('textarea')).toBeNull()
})

test('paired: the chat, and the tools it cannot use', async () => {
    globalThis.fetch = (async () =>
        Response.json({
            paired: true,
            missing: ['WebSearch'],
            command: '',
            link: '',
            install: '',
        })) as unknown as typeof fetch
    using _chat = await mount(ClaudeCodeChat({}))
    await settled()
    expect(step()).toBe('paired')
    expect(
        document.querySelector('[data-pairing=missing]')?.textContent,
    ).toContain('WebSearch')
    expect(document.querySelector('textarea')?.placeholder).toBe(
        'Which company is Grace at?',
    )
})
