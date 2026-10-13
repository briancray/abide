// 16.68 — A REFUSAL THAT REACHES A STREAM AFTER IT ANSWERED is the stream's last frame, and its reader
// refuses with it: by then the status line has gone, so a dropped connection was all a browser saw —
// `undefined network error` on a report whose source stopped, where 16.59 promises a 504.

import { expect, test } from 'bun:test'
import { bodyOf } from '#server/answerValue.ts'
import { isFailed } from '#shared/Failed.ts'
import { answerChunks } from '#shared/framing.ts'
import { refuse } from '#shared/refuse.ts'

async function* stalls(): AsyncGenerator<unknown> {
    yield { week: 1 }
    throw refuse(504)
}

async function read(
    body: ReadableStream<Uint8Array>,
    type: string,
): Promise<{ chunks: unknown[]; refused: unknown }> {
    const chunks: unknown[] = []
    try {
        for await (const chunk of answerChunks(body, type)) chunks.push(chunk)
    } catch (thrown) {
        return { chunks, refused: thrown }
    }
    return { chunks, refused: undefined }
}

// THE REVERT: send `controller.error` for a refusal in `bodyOf`, as for any throw; the read rejects
// with the stream's own error and no status.
test('a refusal after a jsonl stream answered is its last line, read back as the refusal — 16.68', async () => {
    const [sent, readable] = bodyOf(stalls(), 'jsonl').tee()
    expect(await new Response(sent).text()).toBe(
        '{"week":1}\n{"$refusal":{"type":"about:blank","title":"Gateway Timeout","status":504,"detail":"Gateway Timeout"}}\n',
    )
    const { chunks, refused } = await read(readable, 'application/jsonl')
    expect(chunks).toEqual([{ week: 1 }])
    expect(isFailed(refused) && refused.status).toBe(504)
})

test('a refusal after an sse stream answered is a refusal event, read back as the refusal — 16.68', async () => {
    const [sent, readable] = bodyOf(stalls(), 'sse').tee()
    expect(await new Response(sent).text()).toContain(
        'event: refusal\ndata: {"type":"about:blank","title":"Gateway Timeout","status":504',
    )
    const { chunks, refused } = await read(readable, 'text/event-stream')
    expect(chunks).toEqual([{ week: 1 }])
    expect(isFailed(refused) && refused.status).toBe(504)
})

// A VALUE THAT ONLY LOOKS LIKE ONE is a chunk: another key beside the reserved one, or no Problem
// Details under it.
test('a chunk carrying the reserved key and anything else is a chunk — 16.68', async () => {
    const line =
        '{"$refusal":{"type":"about:blank","status":504},"also":1}\n{"$refusal":3}\n'
    const { chunks, refused } = await read(
        new Response(line).body as ReadableStream<Uint8Array>,
        'application/jsonl',
    )
    expect(refused).toBeUndefined()
    expect(chunks).toHaveLength(2)
})
