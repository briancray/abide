// 18.37, 18.38 — A TRIGGER NARROWED TO ONE BROWSER. Two browsers follow one handler built per request —
// whoever is signed in at each, its `principal.caller` is what tells them apart (26.6) — and a refresh
// given one's caller reaches that browser's follow alone. A browser cannot give one.

import { expect, test } from 'bun:test'

import { Mux, type MuxConnection } from '#server/answerSocket.ts'
import { Followers } from '#server/Followers.ts'
import type { FollowedHandler } from '#server/mountHandlers.ts'
import { inOpenScope, scopeFor } from '#server/requestScope.ts'
import { GET } from '#shared/rpc.ts'

type Frame = { op: string; id: number }

const cart = GET(() => ['the cart of whoever asks']) as unknown as {
    address: string
    refresh(pattern?: unknown, options?: { caller?: string }): void
    invalidate(pattern?: unknown, options?: { caller?: string }): void
}
cart.address = '/cart'
const row: FollowedHandler = {
    address: '/cart',
    rungs: [],
    copy: undefined,
    handler: cart as unknown as FollowedHandler['handler'],
}

function browser(mux: Mux, caller: string, frames: Frame[]): MuxConnection {
    return mux.connect(
        new Request('http://app.test/__abide/socket', {
            headers: {
                cookie: `abide-caller=${caller}; abide-principal=${caller}-seal`,
            },
        }),
        {
            send(text: string) {
                frames.push(JSON.parse(text))
            },
            close() {},
        },
    )
}

// THE REVERT: drop the `caller` test from `Followers.broadcast`, which is the trigger every follow was
// sent before; bo's browser is sent 1 refresh and 1 invalidate where 0 are due.
test('a trigger given a caller reaches that browser’s follows alone — 18.37', async () => {
    const mux = new Mux(
        (address) => (address === row.address ? row : undefined),
        new Followers(),
        undefined,
    )
    const ada: Frame[] = []
    const bo: Frame[] = []
    const connections = [browser(mux, 'ada', ada), browser(mux, 'bo', bo)]
    for (const connection of connections)
        await connection.message(
            JSON.stringify({ op: 'sub', id: 1, address: row.address }),
        )
    inOpenScope(
        scopeFor(new Request('http://app.test/checkout'), undefined, undefined),
        () => {
            cart.refresh(undefined, { caller: 'ada' })
            cart.invalidate(undefined, { caller: 'ada' })
        },
    )
    const ops = (frames: Frame[]) => frames.map((frame) => frame.op)
    expect({ ada: ops(ada), bo: ops(bo) }).toEqual({
        ada: ['refresh', 'invalidate'],
        bo: [],
    })
    // Given none, it reaches both, as it always has (7.18).
    inOpenScope(
        scopeFor(new Request('http://app.test/restock'), undefined, undefined),
        () => cart.refresh(),
    )
    expect(ops(bo)).toEqual(['refresh'])
    for (const connection of connections) connection.close()
})

// 18.38 — A BROWSER CANNOT TELL WHOSE CALLER IT IS (26.22), so it cannot narrow by one. THE REVERT:
// drop the browser test in `rpc.ts`; the trigger refreshes this browser's copy whoever it names.
test('a trigger given a caller in a browser throws — 18.38', () => {
    expect(() => cart.refresh(undefined, { caller: 'ada' })).toThrow(
        'RULEBOOK 18.38',
    )
    expect(() => cart.refresh()).not.toThrow()
})
