// `handle` — A RESPONSE THE APP FETCHED ITSELF, read as its type says (54.23-54.26). Each response is
// built here: what `handle` reads is a `Response`, wherever it came from.

import { expect, test } from 'bun:test'

import { handle } from '#shared/handle.ts'

// THE REVERT: read every body as text, and a contact arrives as the string of its JSON.
test('JSON is its value, text is a string, and anything else is a Blob — 54.23, 54.26', async () => {
    expect(await handle(Response.json({ name: 'Ada Lovelace' }))).toEqual({
        name: 'Ada Lovelace',
    })
    expect(
        await handle(
            new Response('{"name":"Ada"}', {
                headers: { 'content-type': 'application/vnd.api+json' },
            }),
        ),
    ).toEqual({ name: 'Ada' })
    expect(
        await handle(
            new Response('Ada Lovelace', {
                headers: { 'content-type': 'text/plain; charset=utf-8' },
            }),
        ),
    ).toBe('Ada Lovelace')
    const card = await handle(
        new Response(new Uint8Array([137, 80, 78, 71]), {
            headers: { 'content-type': 'image/png' },
        }),
    )
    expect(card).toBeInstanceOf(Blob)
    expect((card as Blob).type).toBe('image/png')
    expect(await handle(new Response(null, { status: 204 }))).toBeUndefined()
})

// THE REVERT: cancel a refused body unread — every `cause` below is `undefined`.
test('a status outside 2xx, and JSON that does not parse, are a FetchFailed — 54.24', async () => {
    const missing = await handle(new Response('no', { status: 404 }))
    expect(missing).toMatchObject({
        name: 'FetchFailed',
        data: { status: 404, reason: 'status' },
    })
    expect((missing as Error).cause).toBe('no')
    const unroutable = await handle(
        Response.json({ error: 'No path could be found' }, { status: 422 }),
    )
    expect((unroutable as Error).cause).toEqual({
        error: 'No path could be found',
    })
    const garbled = await handle(
        new Response('<html>', {
            status: 502,
            headers: { 'content-type': 'application/json' },
        }),
    )
    expect((garbled as Error).cause).toBe('<html>')
    const declaredLong = await handle(
        new Response('x'.repeat(70_000), { status: 500 }),
    )
    expect((declaredLong as Error).cause).toBeUndefined()
    const broken = await handle(
        new Response('<html>', {
            headers: { 'content-type': 'application/json' },
        }),
    )
    expect(broken).toMatchObject({ data: { reason: 'shape' } })
    expect((broken as Error).cause).toBeInstanceOf(SyntaxError)
})

// THE REVERT: read a stream to its end before handing it back, and the first chunk waits on the
// last.
test('a JSON Lines stream is its chunks, each as it arrives — 54.25', async () => {
    let push: (line: string) => void = () => {}
    let end: () => void = () => {}
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder()
            push = (line) => controller.enqueue(encoder.encode(line))
            end = () => controller.close()
        },
    })
    const chunks = (await handle(
        new Response(body, {
            headers: { 'content-type': 'application/jsonl' },
        }),
    )) as AsyncIterable<unknown>
    const reading = chunks[Symbol.asyncIterator]()
    push('{"deal":"Engine renewal"}\n')
    expect((await reading.next()).value).toEqual({ deal: 'Engine renewal' })
    push('{"deal":"Ledger audit"}\n')
    end()
    expect((await reading.next()).value).toEqual({ deal: 'Ledger audit' })
    expect((await reading.next()).done).toBe(true)
})

test('what fetch throws reaches the caller untouched', async () => {
    const thrown = await fetch('http://127.0.0.1:1/')
        .then(handle)
        .catch((error: unknown) => error)
    expect((thrown as { code?: string }).code).toBe('ECONNREFUSED')
})
