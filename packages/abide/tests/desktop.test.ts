// 38.140, 38.141 — WHICH DESKTOP WINDOW A REQUEST CAME FROM, read off the user agent the window
// tags. One server answers a browser and a window connected to it at once (38.71), so the answer is
// the request's, never the process's, and the page that request loaded reads the same.

import { expect, test } from 'bun:test'

import { desktop, GET } from '#server'
import { desktopUserAgent } from '#server/desktopUserAgent.ts'

import { inMemoryApp } from './inMemoryApp.ts'

// THE REVERT is the server slot left unfilled in `installServer`: every request reads '' and the
// window's answers `"none"` where `"1.4.0"` is due.
test('desktop() answers per request, and nothing outside one — 38.141', async () => {
    await using app = await inMemoryApp({
        'probe/shell.handler.ts': {
            default: GET(() => desktop()?.version ?? 'none'),
        },
    })
    const asked = (agent: string): Promise<string> =>
        app
            .fetch(
                new Request('http://app.test/probe/shell', {
                    headers: { 'user-agent': agent },
                }),
            )
            .then((answer) => answer.json())
    const [window, browser] = await Promise.all([
        asked(desktopUserAgent('1.4.0')),
        asked('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15'),
    ])
    const outside = await app.run(() => desktop()?.version ?? 'none')
    expect(`window ${window}, browser ${browser}, outside ${outside}`).toBe(
        'window 1.4.0, browser none, outside none',
    )
})

// THE REVERT is `desktop` reading the server slot on both sides: outside a request it reads ''
// and the page answers `undefined` where the window's `navigator.userAgent` names `2.0.1`.
test('a page reads the user agent of the window it is in — 38.141', () => {
    const agent = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    try {
        expect(desktop()).toBeUndefined()
        Object.defineProperty(navigator, 'userAgent', {
            value: desktopUserAgent('2.0.1'),
            configurable: true,
        })
        expect(desktop()).toEqual({ version: '2.0.1' })
    } finally {
        if (agent === undefined)
            delete (navigator as { userAgent?: string }).userAgent
        else Object.defineProperty(navigator, 'userAgent', agent)
    }
})
