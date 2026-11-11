// 18.36 — A FOLLOWER REACHED BY WHO IT IS. A follow of a handler abide mounts is watched in its
// connection's scope, so what the watch reads there — the upgrade's `principal.caller` — is what a
// trigger meant for one browser is filed under, and no browser names whose state it follows.

import { expect, test } from 'bun:test'

import { Mux, type MuxConnection } from '#server/answerSocket.ts'
import { callerOf } from '#server/callerOf.ts'
import { Followers } from '#server/Followers.ts'
import { followedOwn, mountedOwn } from '#server/mountHandlers.ts'
import { GET } from '#shared/rpc.ts'

type Frame = { op: string; id: number }

// The browsers following, by caller, as the watch filed them.
const POKES = new Map<string, Set<(member: 'refresh') => void>>()

const OWN = followedOwn(
    mountedOwn(
        '/__abide/watched-test',
        'watchedTest',
        GET(() => 'state'),
    ),
    (poke) => {
        const caller = callerOf() ?? ''
        let pokes = POKES.get(caller)
        if (pokes === undefined) POKES.set(caller, (pokes = new Set()))
        pokes.add(poke)
        return () => pokes.delete(poke)
    },
)

function connectAs(mux: Mux, caller: string, frames: Frame[]): MuxConnection {
    return mux.connect(
        new Request('http://app.test/__abide/socket', {
            headers: { cookie: `abide-caller=${caller}` },
        }),
        {
            send(text: string) {
                frames.push(JSON.parse(text))
            },
            close() {},
        },
    )
}

// THE REVERT: hand the watch a poke that broadcasts the trigger to every follower of the handler —
// the only reach a trigger had before (7.18) — and beta's connection is sent 1 refresh where 0 is due.
test('a trigger filed under one caller reaches that browser’s follows alone — 18.36', async () => {
    const mux = new Mux(
        (address) => (address === OWN[0] ? OWN[1] : undefined),
        new Followers(),
        undefined,
    )
    const alpha: Frame[] = []
    const beta: Frame[] = []
    const alphaConnection = connectAs(mux, 'alpha', alpha)
    const betaConnection = connectAs(mux, 'beta', beta)
    for (const connection of [alphaConnection, betaConnection])
        await connection.message(
            JSON.stringify({ op: 'sub', id: 1, address: OWN[0] }),
        )

    for (const poke of POKES.get('alpha') ?? []) poke('refresh')

    expect(alpha.filter((frame) => frame.op === 'refresh').length).toBe(1)
    expect(beta.filter((frame) => frame.op === 'refresh').length).toBe(0)

    // 18.17 — the watch stops with the connection, so a closed browser is filed nowhere.
    alphaConnection.close()
    expect(POKES.get('alpha')?.size ?? 0).toBe(0)
    expect(POKES.get('beta')?.size).toBe(1)
    betaConnection.close()
})
