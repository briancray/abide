// 22.11 — WHICH SIDE THE WORK IS ON, in the process every app test runs in: a DOM preloaded
// (`bunfig.toml`), and the server's half answered in the same module instances as the browser's. A
// `typeof document` test reads that process as a browser on both sides, so an app's server render
// took the browser branch, and 12.7's re-throw failed the handler whose effect threw.

import { expect, test } from 'bun:test'

import { GET, isServer, online, watch } from '#server'
import { type Component, render } from '#server/render.ts'

import { inMemoryApp } from './inMemoryApp.ts'

// What one request saw, and what the handler whose effect threw answered with.
async function answered(): Promise<{ side: string; threw: string }> {
    await using app = await inMemoryApp({
        'probe/side.handler.ts': {
            default: GET(() => ({ server: isServer(), online: online() })),
        },
        'probe/effect.handler.ts': {
            default: GET(() => {
                watch(() => {
                    throw new Error('boom')
                })
                return 'answered'
            }),
        },
    })
    const side = await app.fetch(new Request('http://app.test/probe/side'))
    const warn = console.warn
    console.warn = (): void => {}
    try {
        const threw = await app.fetch(
            new Request('http://app.test/probe/effect'),
        )
        return {
            side: JSON.stringify(await side.json()),
            threw: `${threw.status} ${await threw.text()}`,
        }
    } finally {
        console.warn = warn
    }
}

// THE REVERT is `isServer` answering `typeof document === 'undefined'`, the test the core read a
// server by: `{"server":false,"online":false}`, and `effectThrew` keeping its `typeof document`
// alone answers `500` where `200 "answered"` is due — the effect's throw re-thrown (12.7). `online`
// is asked with the emulator's `navigator.onLine` false, which a browser answers and a server does
// not (23.8).
test('a request answered beside a DOM is a server, and an effect throw does not fail it — 22.11, 12.7, 23.8', async () => {
    const onLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', {
        value: false,
        configurable: true,
    })
    try {
        expect(`outside: ${isServer()}`).toBe('outside: false')
        const { side, threw } = await answered()
        expect(side).toBe('{"server":true,"online":true}')
        expect(threw).toBe('200 "answered"')
    } finally {
        if (onLine === undefined)
            delete (navigator as { onLine?: boolean }).onLine
        else Object.defineProperty(navigator, 'onLine', onLine)
    }
})

// `render` OUTSIDE EVERY REQUEST is a server's too: `mount`'s first half (38.119) is one, run beside
// the browser half that hydrates it. THE REVERT is `renderDocument` not entering `inRender`:
// `during: false`.
test('a render outside every request is a server — 22.11', async () => {
    let during: boolean | undefined
    const component = (() => {
        during = isServer()
        return { head: '', body: '', document: undefined }
    }) as unknown as Component
    await render(component)
    expect(`during: ${during}, after: ${isServer()}`).toBe(
        'during: true, after: false',
    )
})
