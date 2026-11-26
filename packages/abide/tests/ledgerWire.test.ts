// 58.5, 58.4 — A LEDGER ACROSS THE WIRE is a streaming `GET` whose body yields what calling the ledger
// hands on (9.6, 16.93), so a reader across the wire is handed
// every entry past its position and then each one appended after — live, with the answer still
// open — and the append is a `POST` whose args carry the key an outbox resend repeats.

import { expect, test } from 'bun:test'

import { ledger, rpc } from '#server'

import { inMemoryApp } from './inMemoryApp.ts'

const ORIGIN = 'http://ledger-wire.test'

type Call = { contact: string; minutes: number }

const calls = ledger<Call>()

const getCalls = rpc(async function* ({ after }: { after: number }) {
    yield* calls(after)
})
const logCall = rpc(
    ({ call, key }: { call: Call; key: string }) => calls.append(call, { key }),
    { methods: ['POST'] },
)

test('a ledger read across the wire is handed every entry, then each one appended after — 58.4, 58.5', async () => {
    const app = await inMemoryApp({
        'calls/getCalls.server.ts': { default: getCalls },
        'calls/logCall.server.ts': { default: logCall },
    })
    const append = (call: Call, key: string): Promise<Response> =>
        app.fetch(
            new Request(`${ORIGIN}/calls/logCall`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ call, key }),
            }),
        )
    await append({ contact: 'c1', minutes: 12 }, 'k1')
    // The outbox's resend of the same call: one entry, not two (58.4).
    await append({ contact: 'c1', minutes: 12 }, 'k1')

    const answer = await app.fetch(
        new Request(`${ORIGIN}/calls/getCalls?after=0`, {
            headers: { accept: 'application/x-ndjson' },
        }),
    )
    const reader = (answer.body as ReadableStream<BufferSource>)
        .pipeThrough(new TextDecoderStream())
        .getReader()
    const lines: { seq: number; entry: Call }[] = []
    let pending = ''
    const nextLine = async (): Promise<void> => {
        for (;;) {
            const newline = pending.indexOf('\n')
            if (newline !== -1) {
                const line = pending.slice(0, newline)
                pending = pending.slice(newline + 1)
                if (line !== '') {
                    lines.push(JSON.parse(line))
                    return
                }
                continue
            }
            const { value, done } = await reader.read()
            if (done) throw new Error('the read ended')
            pending += value
        }
    }
    await nextLine()
    // Appended while the answer is open, and handed on by the same answer.
    await append({ contact: 'c2', minutes: 3 }, 'k2')
    await nextLine()
    await reader.cancel()
    expect(lines.map((line) => `${line.seq}:${line.entry.contact}`)).toEqual([
        '1:c1',
        '2:c2',
    ])
})
