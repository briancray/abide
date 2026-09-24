// 22.4, 22.5, 22.8 — the browser's jar, over happy-dom's `document.cookie`.

import { expect, test } from 'bun:test'
import { cookies, flushSync, watch } from '#shared'
import { COOKIES, Cookies, serializeCookie } from '#shared/cookies.ts'

// 22.4, 22.5 — A READ TRACKS ITS NAME, and a write wakes that name's readers alone. THE REVERT: have
// `get` read `this.every` rather than `versionOf(name)`; the reader of `theme` wakes for `seen` too,
// and has run 2 times after the write to `seen`, where 1 is due.
test('a write wakes the readers of that name alone — 22.4, 22.5', () => {
    const jar = new Cookies('theme=dark', () => {}, true)
    let runs = 0
    let seen = null as string | null
    const stop = watch(() => {
        runs += 1
        seen = jar.get('theme')
    })
    expect(seen).toBe('dark')
    jar.set('seen', '1')
    flushSync()
    expect(runs).toBe(1)
    jar.set('theme', 'light')
    flushSync()
    expect(runs).toBe(2)
    expect(seen).toBe('light')
    stop()
})

// The document's jar writes through to `document.cookie`, and a delete is an expiry.
test("the browser's jar writes the document's cookies", () => {
    const jar = cookies()
    jar.set('flavor', 'oat')
    expect(document.cookie).toContain('flavor=oat')
    expect(jar.get('flavor')).toBe('oat')
    jar.delete('flavor')
    expect(jar.get('flavor')).toBeNull()
    expect(document.cookie).not.toContain('flavor=oat')
})

// 22.3 — `secure` defaults from `NODE_ENV` on a server.
test('secure defaults from NODE_ENV — 22.3', () => {
    const saved = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    expect(serializeCookie({ name: 'a', value: 'b' }, false)).toContain(
        '; Secure',
    )
    process.env.NODE_ENV = 'development'
    expect(serializeCookie({ name: 'a', value: 'b' }, false)).not.toContain(
        'Secure',
    )
    if (saved === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = saved
})

// 22.8 — outside a request on a server, the jar is refused. The server's slot is what throws; the
// browser's is the stand-in until `requestScope.ts` is loaded.
test('cookies throws outside a request on a server — 22.8', async () => {
    const browser = COOKIES.current
    await import('#server/requestScope.ts')
    try {
        expect(() => cookies()).toThrow('outside a request')
    } finally {
        COOKIES.current = browser
    }
})
