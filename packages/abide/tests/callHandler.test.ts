// 38.8 — `abide call` and the shell print a refused call's message, so a route parameter left out
// is refused naming its clause whichever spelling the args took.

import { expect, test } from 'bun:test'

import { callHandler } from '#server/remote.ts'

// THE REVERT: hand the JSON args straight to `rpcRequest`; its default refusal is a ValidationError
// whose message is "Unprocessable Content".
test('a route parameter missing from JSON args is refused naming 30.3, as from name=value args — 38.8', async () => {
    const asked = (args: string[]) =>
        callHandler('http://127.0.0.1:9', 'media/[id]', args, 'GET', []).then(
            () => '',
            (thrown: Error) => thrown.message,
        )
    const expected =
        "abide: /media/[id] was given no 'id', and the route requires it. RULEBOOK 30.3."
    expect(await asked(['{"size":2}'])).toBe(expected)
    expect(await asked([])).toBe(expected)
    expect(await asked(['size=2'])).toBe(expected)
})

// 15.19 — A REFUSAL FOR NOW EXITS AS A FAULT DOES, 8, so a script calls again; one for good exits 7.
// THE REVERT: read `>= 500` alone for `FAULTED` in `callHandler`; the 429 exits 7 where 8 is due.
test('a call refused 429 exits 8 as a 503 does, and a 404 exits 7 — 15.19', async () => {
    let status = 429
    using server = Bun.serve({
        port: 0,
        fetch: () => new Response('{}', { status }),
    })
    const code = async (): Promise<number> =>
        (await callHandler(server.url.origin, 'ping', [], 'GET', [])).code
    expect(await code()).toBe(8)
    status = 503
    expect(await code()).toBe(8)
    status = 404
    expect(await code()).toBe(7)
})
