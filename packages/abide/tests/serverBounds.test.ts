// 16.78, 18.30, 18.31, 44.23 — WHAT A SERVER BOUNDS that a caller sends or is sent outside a handler's
// own body: the MCP endpoint's and the bridge relay's bodies, a socket peer that fell behind, and how
// many values one connection follows. In process (`inMemoryApp.ts`), over a stand-in socket.

import { afterEach, expect, test } from 'bun:test'
import { GET } from '#server'
import {
    answerBridge,
    mintCode,
    openTurn,
    pairedBridge,
    type TurnItem,
} from '#server/bridgeRelay.ts'
import { config } from '#server/config.ts'
import type { BootedApp } from '#server/createApp.ts'
import { inMemoryApp } from './inMemoryApp.ts'

// Who a pairing made outside every request was minted by: no one signed in (44.33).
const SIGNED_OUT = JSON.stringify(null)

const MODULES = {
    'shelf/book.ts': {
        default: GET(({ id }: { id: number }) => ({ id, title: `book ${id}` })),
    },
}

const SET: string[] = []

async function withSetting(name: string, value: string): Promise<void> {
    process.env[name] = value
    SET.push(name)
    config.invalidate()
    await config
}

afterEach(async () => {
    for (const name of SET.splice(0)) delete process.env[name]
    config.invalidate()
    await config
})

/** A socket that records what it is sent and how it is closed, and answers each send with `sent`. */
function standIn(sent: number) {
    const frames: Record<string, unknown>[] = []
    const closes: number[] = []
    return {
        frames,
        closes,
        socket: {
            send(text: string) {
                frames.push(JSON.parse(text))
                return sent
            },
            close(code: number) {
                closes.push(code)
            },
        },
    }
}

const subscribe = (id: number) =>
    JSON.stringify({ op: 'sub', id, address: '/shelf/book', args: { id } })

// 16.78 — THE ENVIRONMENT'S CEILING REACHES `/__abide/mcp`, whose body is read outside every handler.
// THE REVERT: read `request.json()` in `answerMcp` rather than `bodyWithin`'s; the oversized call is
// answered 200 with the tool's result.
test('an MCP body over ABIDE_MAX_REQUEST_BODY_SIZE is refused 413 — 16.78', async () => {
    await withSetting('ABIDE_MAX_REQUEST_BODY_SIZE', '64')
    await using app = await inMemoryApp(MODULES)
    const answer = await app.fetch(
        new Request('http://app.test/__abide/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'get_shelf_book', arguments: { id: 4 } },
            }),
        }),
    )
    expect(answer.status).toBe(413)
})

// 16.78, 44.23 — THE RELAY'S BODY IS UNDER THE SAME CEILING, and a post carrying a line that is not JSON
// is refused 400 with none of its lines relayed. THE REVERTS: read `request.text()` in `relay`, and the
// oversized post is answered 204; parse each line as it is relayed, and the bad post throws out of the
// relay with its first line already in the turn.
test('the bridge relay bounds its body and refuses a line that is not JSON whole — 16.78, 44.23', async () => {
    const { code } = mintCode('bounds', SIGNED_OUT)
    await answerBridge(
        new Request(`http://app.test/__abide/bridge?code=${code}`),
    )
    const bridge = pairedBridge('bounds', SIGNED_OUT)
    if (bridge === undefined) throw new Error('the bridge did not pair')
    const turn = openTurn(bridge)
    const post = (body: string) =>
        answerBridge(
            new Request('http://app.test/__abide/bridge', {
                method: 'POST',
                headers: { authorization: `Bearer ${bridge.token}` },
                body,
            }),
        ) as Promise<Response>
    const event = JSON.stringify({ type: 'event', turn: turn.id, event: 1 })
    let malformed: number | string
    try {
        malformed = (await post(`${event}\n{not json\n`)).status
    } catch {
        malformed = 'threw'
    }
    turn.inbox.close()
    const relayed: TurnItem[] = []
    for await (const item of turn.inbox) relayed.push(item)
    await withSetting('ABIDE_MAX_REQUEST_BODY_SIZE', '16')
    const oversized = (await post(event)).status
    turn.close()
    expect({ malformed, relayed: relayed.length, oversized }).toEqual({
        malformed: 400,
        relayed: 0,
        oversized: 413,
    })
})

// 18.30 — A FRAME BUN DROPPED CLOSES THE PEER, which reconnects naming what it holds, rather than
// leaving it a version behind every frame after. THE REVERT: call `this.socket.send` in `SocketPeer`
// rather than `sendOrClose`; the frame is dropped and the socket is never closed.
test('a socket peer whose frame bun dropped is closed 1013 — 18.30', async () => {
    const app = (await inMemoryApp(MODULES)) as BootedApp
    const { closes, socket } = standIn(0)
    const connection = app
        .openMux()
        .connect(new Request('http://app.test/__abide/socket'), socket)
    // A refusal is a frame like any: no handler answers here, so the first frame sent is one.
    await connection.message(
        JSON.stringify({ op: 'sub', id: 1, address: '/nowhere' }),
    )
    connection.close()
    await app.stop()
    expect(closes).toEqual([1013])
})

// 18.31 — ONE CONNECTION FOLLOWS AT MOST `ABIDE_MAX_SOCKET_SUBSCRIPTIONS` VALUES, and one more is refused
// 429; a frame naming an id it holds replaces that subscription rather than counting. THE REVERT: drop
// the cap in `answerFrame`; the third subscription is followed and sent its value.
test('a connection past ABIDE_MAX_SOCKET_SUBSCRIPTIONS is refused the next one 429 — 18.31', async () => {
    await withSetting('ABIDE_MAX_SOCKET_SUBSCRIPTIONS', '2')
    const app = (await inMemoryApp(MODULES)) as BootedApp
    const { frames, socket } = standIn(1)
    const connection = app
        .openMux()
        .connect(new Request('http://app.test/__abide/socket'), socket)
    for (const id of [1, 2, 2, 3]) await connection.message(subscribe(id))
    connection.close()
    await app.stop()
    const refused = frames.filter((frame) => frame.op === 'error')
    expect(
        refused.map((frame) => [
            frame.id,
            (frame.error as { status: number }).status,
        ]),
    ).toEqual([[3, 429]])
})
