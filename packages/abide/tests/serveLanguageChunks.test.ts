// 38.11 — `abide lsp`'s reader, AS A COUNT: a message arriving in many chunks is copied once, not
// once per chunk. Every copy the reader makes is a `Uint8Array#set`, so the bytes it copies are
// counted there, and the claim is a RATIO between two sizes of message in the same chunk size —
// linear is 4x for 4x the bytes. THE REVERT: join each chunk onto the pending buffer as it arrives
// (`new Uint8Array(buffer.length + chunk.length)` per chunk) and the ratio reads 14.1.

import { expect, test } from 'bun:test'

import { serveLanguage } from '#compiler/serveLanguage.ts'

const CHUNK = 64 * 1024
const ENCODER = new TextEncoder()

function framed(message: object): Uint8Array {
    const body = ENCODER.encode(JSON.stringify({ jsonrpc: '2.0', ...message }))
    const head = ENCODER.encode(`Content-Length: ${body.length}\r\n\r\n`)
    const out = new Uint8Array(head.length + body.length)
    out.set(head)
    out.set(body, head.length)
    return out
}

async function bytesCopied(size: number): Promise<number> {
    const big = framed({
        id: 1,
        method: 'x/unserved',
        params: { blob: 'a'.repeat(size) },
    })
    const exit = framed({ method: 'exit' })
    const chunks: Uint8Array[] = []
    for (let at = 0; at < big.length; at += CHUNK)
        chunks.push(big.slice(at, at + CHUNK))
    chunks.push(exit)
    let next = 0
    const input = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (next < chunks.length) controller.enqueue(chunks[next++])
            else controller.close()
        },
    })
    const answered: Uint8Array[] = []
    const set = Uint8Array.prototype.set
    let copied = 0
    Uint8Array.prototype.set = function (
        this: Uint8Array,
        source: ArrayLike<number>,
        offset?: number,
    ) {
        copied += source.length
        return set.call(this, source, offset)
    }
    try {
        await serveLanguage(undefined, input, (bytes) => answered.push(bytes))
    } finally {
        Uint8Array.prototype.set = set
    }
    // The request was read whole: it was answered as one not served.
    expect(new TextDecoder().decode(answered[1])).toContain(
        'x/unserved is not served',
    )
    return copied
}

test('a message in many chunks is copied once — 38.11', async () => {
    const one = await bytesCopied(1 << 20)
    const four = await bytesCopied(4 << 20)
    expect(`ratio: ${(four / one).toFixed(1)}`).toBe('ratio: 4.0')
})
