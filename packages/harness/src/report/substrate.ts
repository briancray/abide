// WHICH ENGINE THIS IS, and it is read off the user agent rather than probed.
//
// A feature probe would be better and there is no longer one: `Error.captureStackTrace`
// was V8-only and is now in JSC and SpiderMonkey too, `InternalError` reads `undefined`
// in every engine tested here, and `webkitURL` / `onwebkitanimationend` are true in
// Chromium as well as WebKit. Measured across chromium 1243 and webkit 2336 — every
// candidate discriminator came back identical in both.
//
// This matters more than it did when the only two substrates were `bun test` and a
// chromium gate. The same graph reads 1.67x a hand-written signal under JSC and 0.21x
// under V8, and a panel that measures in the reader's own browser meets all three
// engines. Reporting `v8` for Safari would let `ratio()` compare two of them.
export function substrate(): 'jsc' | 'v8' | 'spidermonkey' | 'unknown' {
    // Bun IS JSC, and it is the one case with no user agent worth reading. Probed by
    // the MEMBER: a docs example frame defines a `Bun.serve` shim so a hand-written
    // arm's `server.ts` can run in the page, and a bare `globalThis.Bun` check called
    // headless chromium JavaScriptCore.
    const bun = (globalThis as { Bun?: { nanoseconds?: unknown } }).Bun
    if (typeof bun?.nanoseconds === 'function') return 'jsc'
    const agent = globalThis.navigator?.userAgent ?? ''
    if (/Firefox\//.test(agent)) return 'spidermonkey'
    // Chromium's agent carries `Safari/` too, so this order is the whole check.
    if (/Edg\/|Chrome\/|Chromium\//.test(agent)) return 'v8'
    if (/Safari\//.test(agent)) return 'jsc'
    return 'unknown'
}
