// 22.4, 22.5, 22.8 — the browser's jar, over happy-dom's `document.cookie`.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { cookies, flushSync, watch } from '#shared'
import {
    browserCookies,
    COOKIES,
    Cookies,
    serializeCookie,
} from '#shared/cookies.ts'

// THE BROWSER'S SLOT, PINNED for every test here. A file earlier in the same process that installs
// the server (`installServer`) leaves `COOKIES.current` reading the request, and `cookies()` then
// refuses. THE REVERT: drop the pin; run after `bind.test.ts` in one process, the 3 tests that call
// `cookies()` throw the request scope's refusal (22.1).
let slotAsFound = COOKIES.current
beforeEach(() => {
    slotAsFound = COOKIES.current
    COOKIES.current = browserCookies
})
afterEach(() => {
    COOKIES.current = slotAsFound
})

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

// 22.6 — A `cookieStore` CHANGE IS HELD DECODED, as `document.cookie` is read: the event carries the
// encoded text a write put there, so held raw, `Ada Lovelace` read back as `Ada%20Lovelace` until a
// reload, and the write woke its readers a second time. THE REVERT: compare and store `cookie.value`
// as it came in the `change` listener in `browserCookies`; the read is `Ada%20Lovelace`.
test("a cookieStore change is held decoded, and a write's own echo wakes nobody — 22.6", () => {
    const jar = cookies()
    let runs = 0
    let seen = null as string | null
    const stop = watch(() => {
        runs += 1
        seen = jar.get('person')
    })
    jar.set('person', 'Ada Lovelace')
    flushSync()
    expect(document.cookie).toContain('person=Ada%20Lovelace')
    const store = (globalThis as unknown as { cookieStore: EventTarget })
        .cookieStore
    store.dispatchEvent(
        Object.assign(new Event('change'), {
            changed: [{ name: 'person', value: 'Ada%20Lovelace' }],
            deleted: [],
        }),
    )
    flushSync()
    expect(seen).toBe('Ada Lovelace')
    expect(runs).toBe(2)
    stop()
    jar.delete('person')
})

// A BROWSER'S JAR KEEPS NO `set-cookie` LINES: its writes went into the document, and it lives as
// long as the page, so a line held per write grew with nothing to read it. A server's jar keeps
// them. THE REVERT: push onto `writes` whatever the side in `Cookies.write`; the browser's jar
// holds every line written through it — the 3 this test writes, and the 4 the tests above it write
// when the file runs whole.
test("a browser's jar holds no set-cookie lines; a server's does", () => {
    const browser = cookies()
    for (let write = 0; write < 3; write++) browser.set('draft', String(write))
    expect(browser.toSetCookieHeaders()).toEqual([])
    browser.delete('draft')
    const server = new Cookies('', () => {}, false)
    server.set('draft', '1')
    expect(server.toSetCookieHeaders()).toHaveLength(1)
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
// browser's is the stand-in until a server installs its own.
test('cookies throws outside a request on a server — 22.8', async () => {
    COOKIES.current = (await import('#server/requestScope.ts')).requestCookies
    expect(() => cookies()).toThrow('outside a request')
})
