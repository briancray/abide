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

// 43.28 — AND ITS SOCKET AND ITS STREAMS: a test opens a socket to a server it runs in process, with
// the headers bun's `WebSocket` takes, and pipes a body through a `TransformStream`. THE REVERT: drop
// `WebSocket` from the restore and happy-dom's throws "The subprotocol '[object Object]' is invalid";
// drop `TransformStream` and `pipeThrough` throws "The transform's 'readable' property must be a
// ReadableStream" — happy-dom's is node's `Transform`.
test('the preload leaves bun its own WebSocket and web streams — 43.28', async () => {
    using server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (request, served) =>
            served.upgrade(request, { data: request.headers.get('x-tab') })
                ? undefined
                : new Response('not a socket', { status: 400 }),
        websocket: {
            data: undefined as unknown as string | null,
            message: (socket, message) => {
                socket.send(`${socket.data} ${message}`)
            },
        },
    })
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
        headers: { 'x-tab': 'one' },
    } as never)
    const echoed = await new Promise<string>((resolve, reject) => {
        socket.onopen = () => socket.send('hi')
        socket.onmessage = (event) => resolve(String(event.data))
        socket.onerror = () => reject(new Error('the socket did not open'))
    })
    socket.close()
    expect(echoed).toBe('one hi')
    const piped = new Response('streamed').body?.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>(),
    )
    expect(await new Response(piped).text()).toBe('streamed')
})

// 43.35 — A PARSED DOCUMENT FETCHES NOTHING IT NAMES: a server-rendered page parsed in a test names
// its stylesheets and its script at an address nothing in the test answers. THE REVERT: register the
// DOM with no `settings`; `asked` reads 2.
//
// `waitUntilComplete` waits on EVERY task the process's one window holds, and under
// `bun run test:serial` every earlier file left its own there — a keyed value's `ttl` in
// `bareSelection.test.ts` arms a 60 s timer, and the wait outlived the test's 5 s. So what earlier
// files left is aborted first, and the wait is on this test's own. THE REVERT: drop the `abort`;
// `bun test packages/abide/tests/bareSelection.test.ts packages/harness/tests/preload.test.ts`
// times out.
test('a document parsed under the preload fetches no stylesheet or script it names — 43.35', async () => {
    const happyDOM = (
        window as unknown as {
            happyDOM: {
                abort(): Promise<void>
                waitUntilComplete(): Promise<void>
            }
        }
    ).happyDOM
    await happyDOM.abort()
    let asked = 0
    using server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => {
            asked += 1
            return new Response('', { headers: { 'content-type': 'text/css' } })
        },
    })
    const origin = `http://127.0.0.1:${server.port}`
    document.head.innerHTML = `<link rel="stylesheet" href="${origin}/entry.css"><script src="${origin}/entry.js"></script>`
    new DOMParser().parseFromString(
        `<html><head><link rel="stylesheet" href="${origin}/parsed.css"></head><body></body></html>`,
        'text/html',
    )
    await happyDOM.waitUntilComplete()
    document.head.innerHTML = ''
    expect(asked).toBe(0)
})
