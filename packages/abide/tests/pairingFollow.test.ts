// 18.36, 44.69, 44.22 — `/__abide/pairing` FOLLOWED OVER THE MUX. Two browsers follow their pairings on
// one app's mux; a bridge pairs, a code expires and a page leaves, and what is asserted is the
// frames each browser's connection is sent and what the bridge is told — no stream is held open.

import { afterEach, expect, jest, test } from 'bun:test'

import type { MuxConnection } from '#server/answerSocket.ts'
import type { BootedApp } from '#server/createApp.ts'
import { BRIDGE_ADDRESS, PAIRING_ADDRESS } from '#shared/ADDRESSES.ts'
import type { BridgeStatus } from '#shared/BridgeStatus.ts'

import { inMemoryApp } from './inMemoryApp.ts'

type Frame = { op: string; id: number }

afterEach(() => {
    jest.useRealTimers()
})

/** A browser at `caller` following its pairing over `app`'s mux, and the frames it is sent. */
async function following(
    app: BootedApp,
    caller: string,
): Promise<{ connection: MuxConnection; refreshes: () => number }> {
    const frames: Frame[] = []
    const connection = app.openMux().connect(
        new Request('http://site/__abide/socket', {
            headers: { cookie: `abide-caller=${caller}` },
        }),
        {
            send(text: string) {
                frames.push(JSON.parse(text))
            },
            close() {},
        },
    )
    await connection.message(
        JSON.stringify({ op: 'sub', id: 1, address: PAIRING_ADDRESS }),
    )
    return {
        connection,
        refreshes: () =>
            frames.filter((frame) => frame.op === 'refresh').length,
    }
}

/** What `/__abide/pairing` answers the browser at `caller`. */
async function statusOf(app: BootedApp, caller: string): Promise<BridgeStatus> {
    const answer = await app.fetch(
        new Request(`http://site${PAIRING_ADDRESS}`),
        {
            caller,
        },
    )
    return (await answer.json()) as BridgeStatus
}

/** A bridge paired by `status`'s code: its stream, read until it says `until`. */
async function pairedBy(
    app: BootedApp,
    status: BridgeStatus,
): Promise<{ until(word: string): Promise<void>; hangUp(): void }> {
    const code = new URL(status.link).searchParams.get('code')
    const dialed = new AbortController()
    const answer = await app.fetch(
        new Request(`http://site${BRIDGE_ADDRESS}?code=${code}`, {
            signal: dialed.signal,
        }),
    )
    expect(answer.status).toBe(200)
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let read = ''
    return {
        async until(word) {
            while (!read.includes(word)) {
                const next = await reader.read()
                if (next.done)
                    throw new Error(`the bridge's stream ended before ${word}`)
                read += decoder.decode(next.value)
            }
        },
        hangUp: () => dialed.abort(),
    }
}

// 18.36 — A PAIRING IS SAID TO THE BROWSER IT IS TO: a bridge pairing alpha's code refreshes alpha's
// follow, and beta's is sent nothing. THE REVERT: file the follow's watch under a key its connection's
// scope does not decide (`pairingKey('', '')` in `watchFollowedPairing`); alpha is sent 0 refreshes
// where 1 is due. The caller-blind arm, a broadcast to every follow, is `followWatch.test.ts`'s.
test('a bridge pairing one browser refreshes that browser’s follow alone — 18.36, 44.69', async () => {
    await using app = (await inMemoryApp({})) as BootedApp
    const alpha = await following(app, 'alpha')
    const beta = await following(app, 'beta')
    const before = await statusOf(app, 'alpha')
    expect(before.paired).toBe(false)

    const bridge = await pairedBy(app, before)
    await bridge.until('paired')

    expect({ alpha: alpha.refreshes(), beta: beta.refreshes() }).toEqual({
        alpha: 1,
        beta: 0,
    })
    // What the refresh reads: paired, with a fresh code in place of the one the bridge spent.
    const after = await statusOf(app, 'alpha')
    expect(after.paired).toBe(true)
    expect(after.link).not.toBe(before.link)
    expect((await statusOf(app, 'beta')).paired).toBe(false)
    bridge.hangUp()
    alpha.connection.close()
    beta.connection.close()
})

// 44.69 — A CODE THAT EXPIRES IS SAID TO WHOEVER FOLLOWS ITS PAIRING, and reading it again answers a
// fresh one; read again before then, it answers the same. THE REVERT: arm no expiry in `pairingNow`;
// 0 refreshes where 1 is due.
test('a code that expires refreshes the pairing’s follow, and the next read is a fresh one — 44.69', async () => {
    await using app = (await inMemoryApp({})) as BootedApp
    const browser = await following(app, 'expiring')
    jest.useFakeTimers()
    const first = await statusOf(app, 'expiring')
    expect((await statusOf(app, 'expiring')).link).toBe(first.link)
    jest.advanceTimersByTime(10 * 60_000)
    expect(browser.refreshes()).toBe(1)
    expect((await statusOf(app, 'expiring')).link).not.toBe(first.link)
    browser.connection.close()
})

// 44.22 — A PAGE FOLLOWING IS A PAGE WATCHING: the bridge outlives it by the grace, and is sent away
// once that runs with no page following and no turn. THE REVERT: hand `watchFollowedPairing` a no-op
// watch; the bridge was never watched, and its stream never says `bye`.
test('a bridge is sent away once no page has followed its pairing for the grace — 44.22', async () => {
    await using app = (await inMemoryApp({})) as BootedApp
    const browser = await following(app, 'leaving')
    const bridge = await pairedBy(app, await statusOf(app, 'leaving'))
    await bridge.until('paired')
    jest.useFakeTimers()
    browser.connection.close()
    jest.advanceTimersByTime(30_000)
    jest.useRealTimers()
    await bridge.until('bye')
    bridge.hangUp()
})
