// 38.24, 38.35, 38.36, 38.37, 38.96 — `abide dev`'s RESPONSE RELAY, both halves in one process over a
// pair of in-memory channels: what `devTransport.test.ts` asserts through a spawned `abide dev`,
// asserted here on the protocol itself. Each message is structured-cloned, as bun's IPC clones it.

import { expect, test } from 'bun:test'

import {
    askOver,
    type Channel,
    type FromRelay,
    serveOver,
    type ToRelay,
} from '#server/responseRelay.ts'

type Fetch = (request: Request) => Promise<Response>

// A worker half answering with `fetch`, reached over a channel the listener half can be pointed at.
function worker(
    fetch: Fetch,
    listener: () => ReturnType<typeof askOver>,
    crossed: string[] = [],
): Channel<ToRelay> {
    const served = serveOver(
        {
            postMessage(message: FromRelay) {
                queueMicrotask(() => listener().take(structuredClone(message)))
            },
        },
        {
            fetch,
            admits: () => false,
            failed: (why) => new Response(why, { status: 500 }),
            failureMarkup: (why) => `<p>broke: ${why.split('\n')[0]}</p>`,
        },
    )
    return {
        postMessage(message) {
            crossed.push(message.kind)
            queueMicrotask(() => void served.take(structuredClone(message)))
        },
    }
}

// The listener half over one worker answering with `fetch`; `crossed` collects what it sends.
function relayOver(
    fetch: Fetch,
    crossed: string[] = [],
): ReturnType<typeof askOver> {
    const listener = askOver(() => {})
    listener.replace(worker(fetch, () => listener, crossed))
    return listener
}

const settled = (): Promise<void> => new Promise((done) => setTimeout(done, 5))

// 38.36 — THE BODY IS READ NO FASTER THAN THE READER READS IT: a pull on the listener's stream is one
// pull of the worker's. THE REVERT: give the listener's stream a high-water mark of 16 rather than 0;
// the source is pulled 17 times before the reader has taken 3 chunks.
test('a body is pulled from the worker one chunk per read — 38.35, 38.36', async () => {
    let pulled = 0
    const relay = relayOver(
        async () =>
            new Response(
                new ReadableStream(
                    {
                        pull(controller) {
                            pulled += 1
                            controller.enqueue(new Uint8Array([pulled]))
                        },
                    },
                    { highWaterMark: 0 },
                ),
            ),
    )
    const response = await relay.ask(new Request('http://dev.test/count'))
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const read: number[] = []
    for (let index = 0; index < 3; index += 1)
        read.push(((await reader.read()).value as Uint8Array)[0] as number)
    await settled()
    expect(read).toEqual([1, 2, 3])
    expect(pulled).toBe(3)
    await reader.cancel()
})

// A DECLARED LENGTH CROSSES WITH THE HEAD, and a bodiless status crosses with none: nothing is
// pulled for either. THE REVERT: drop `whole`; the declared body is pulled, 2 pulls where 0 are due —
// and bun, meeting a first read that waits on the worker, answers it chunked without its length.
test('a body of declared length crosses whole with its head — 38.35', async () => {
    let asked = 0
    const crossed: string[] = []
    const relay = relayOver(async () => {
        asked += 1
        return asked === 1
            ? new Response('whole', { headers: { 'content-length': '5' } })
            : new Response(null, { status: 204 })
    }, crossed)
    const whole = await relay.ask(new Request('http://dev.test/whole'))
    expect(whole.headers.get('content-length')).toBe('5')
    expect(await whole.text()).toBe('whole')
    const empty = await relay.ask(new Request('http://dev.test/empty'))
    expect(`${empty.status} ${empty.body}`).toBe('204 null')
    expect(crossed.filter((kind) => kind === 'pull').length).toBe(0)
})

// 38.37 — A FAILURE AFTER THE HEAD ENDS THE STREAM IN AN ERROR, and an html body is shown what broke
// first. THE REVERT: drop the worker half's markup chunk; the reader sees only `first`. Raising the
// failure at the listener the moment it arrives, rather than on the pull after the chunk ahead of
// it, is NOT seen here: a JS reader always has a read pending when the chunk lands, so the chunk
// is handed over before the error; it is bun's server, reading ahead natively, that loses it.
test('an html body failing mid-stream shows the failure, then errors — 38.37', async () => {
    const relay = relayOver(async () => {
        let sent = false
        return new Response(
            new ReadableStream({
                pull(controller) {
                    if (sent) throw new Error('the database is on fire')
                    sent = true
                    controller.enqueue(new TextEncoder().encode('first'))
                },
            }),
            { headers: { 'content-type': 'text/html' } },
        )
    })
    const response = await relay.ask(new Request('http://dev.test/page'))
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    let text = ''
    let failed = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            text += new TextDecoder().decode(value)
        }
    } catch (thrown) {
        failed = (thrown as Error).message
    }
    expect(text).toBe('first<p>broke: Error: the database is on fire</p>')
    expect(failed).toContain('the database is on fire')
})

// 38.24 — A REQUEST WHOSE HEAD HAS NOT GONE OUT IS ASKED AGAIN of the worker that replaces the one
// answering it, its body with it; 38.37 — one whose head has gone out ends in an error. THE REVERT:
// answer the unanswered one where it stood (`endAll`'s `reask` ignored); it settles 500 with the
// reason rather than the replacement's `again: shelve dune`.
test('a replaced worker’s unanswered request is asked again of the next — 38.24, 38.37', async () => {
    const never: Fetch = () => new Promise<Response>(() => {})
    const streaming: Fetch = async () =>
        new Response(new ReadableStream({ pull() {} }))
    let first: Fetch = streaming
    const listener = askOver(() => {})
    listener.replace(
        worker(
            (request) => first(request),
            () => listener,
        ),
    )
    const headed = await listener.ask(new Request('http://dev.test/stream'))
    const reading = (headed.body as ReadableStream<Uint8Array>)
        .getReader()
        .read()
        .then(
            () => 'read',
            (thrown: Error) => thrown.message,
        )
    first = never
    const asked = listener.ask(
        new Request('http://dev.test/shelve', {
            method: 'POST',
            body: 'dune',
        }),
    )
    await settled()
    listener.replace(undefined)
    listener.endAll('replaced mid-response', true)
    listener.replace(
        worker(
            async (request) =>
                new Response(
                    `again: ${new URL(request.url).pathname.slice(1)} ${await request.text()}`,
                ),
            () => listener,
        ),
    )
    const answered = await asked
    expect(`${answered.status} ${await answered.text()}`).toBe(
        '200 again: shelve dune',
    )
    expect(await reading).toBe('replaced mid-response')
})

// 38.96 — A READER HANGING UP ABORTS THE REQUEST IN THE WORKER, and stops what its body was read
// from. THE REVERT: drop the abort from the worker half's `cancel`; the handler's signal is never
// aborted, `false` where `true` is due.
test('cancelling the body aborts the request and its source — 38.96', async () => {
    let signal: AbortSignal | undefined
    let cancelled = false
    const relay = relayOver(async (request) => {
        signal = request.signal
        return new Response(
            new ReadableStream({
                pull(controller) {
                    controller.enqueue(new Uint8Array([1]))
                },
                cancel() {
                    cancelled = true
                },
            }),
        )
    })
    const response = await relay.ask(new Request('http://dev.test/long'))
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    await reader.cancel()
    await settled()
    expect(`${signal?.aborted} ${cancelled}`).toBe('true true')
})
