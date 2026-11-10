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
