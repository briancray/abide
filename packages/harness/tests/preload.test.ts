// 43.28 — THE DOM IS HAPPY-DOM'S AND THE WIRE IS BUN'S. A test under the preload builds requests and
// blobs for a server it runs in process, and happy-dom's own drop a `cookie` header a test sets and
// hand a handler a `Blob` with no `bytes()`. THE REVERT: drop the restore in `measure/preload.ts`;
// the cookie reads `null` and `bytes` is not a function.

import { expect, test } from 'bun:test'

test('the preload leaves bun its own fetch family — 43.28', async () => {
    const request = new Request('http://app.invalid/', {
        headers: { cookie: 'theme=dark' },
    })
    expect(request.headers.get('cookie')).toBe('theme=dark')
    expect(typeof new Blob(['csv']).bytes).toBe('function')
    // And the DOM is still there to render into.
    expect(document.createElement('p').tagName).toBe('P')
})
