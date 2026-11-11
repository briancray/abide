// 16.97 — AN EARLY-CALLED STREAM, HANDED TO THE MUX AFTER ITS FIRST CHUNK. The head's early-call script
// starts a streaming `GET` before the bundle has arrived, so its first chunk is painted without
// waiting on the bundle and the socket — but held open over http, it would keep one of the browser's
// few connections for as long as it streams. So its answer goes over http until its first line and
// what was ready with it have been sent, or `HANDOFF_MILLISECONDS` with none: then what is left of
// the same body is parked
// (`parkedAnswers`), and the last line over http is the token the browser takes the rest by, over
// the socket mux. One run, two legs, and the http one ends at once.

import { CONTINUE_KEY } from '#shared/CONTINUE_KEY.ts'

import { park } from './parkedAnswers.ts'

// How long an early call waits on a stream's first chunk before handing what is left to the mux.
const HANDOFF_MILLISECONDS = 1_000
const NEWLINE = 10
const ENCODER = new TextEncoder()

/** `answer`, a jsonl stream, sent over http until its first line, then handed off. */
export function handedOff(answer: Response): Response {
    const body = answer.body as ReadableStream<Uint8Array>
    const reader = body.getReader()
    // What ends the run once it is parked: the leg that took it hanging up, or nobody taking it.
    const run = new AbortController()
    run.signal.addEventListener('abort', () => {
        void reader.cancel(run.signal.reason).catch(() => {})
    })
    // A read the handoff overtook, which the parked rest takes first.
    let pending: ReturnType<typeof reader.read> | undefined
    let leftover: Uint8Array | undefined
    let handed = false
    const rest = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                if (leftover !== undefined) {
                    controller.enqueue(leftover)
                    leftover = undefined
                    return
                }
                const read = pending ?? reader.read()
                pending = undefined
                const { done, value } = await read
                if (done) controller.close()
                else controller.enqueue(value)
            },
            cancel: (reason) => reader.cancel(reason),
            // NOTHING PULLED UNTIL IT IS TAKEN: a stream fills its queue as it is built, and this one
            // would take the first chunk off the http leg it exists to follow.
        },
        { highWaterMark: 0 },
    )
    return new Response(
        new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (handed) return
                // THE FIRST CHUNK, AND EVERY ONE PRODUCED WITH IT: once a line is out, what the run
                // has ready goes too — a seeded transcript whole (41.13), so the page adopts what the
                // server painted — and the first read that would wait is the mux's.
                let sawLine = false
                for (;;) {
                    const read = reader.read()
                    const waited = await Promise.race([
                        read,
                        Bun.sleep(sawLine ? 0 : HANDOFF_MILLISECONDS).then(
                            () => undefined,
                        ),
                    ])
                    if (waited === undefined) {
                        pending = read
                        return hand(controller)
                    }
                    if (waited.done) {
                        if (leftover !== undefined) controller.enqueue(leftover)
                        leftover = undefined
                        return controller.close()
                    }
                    const value =
                        leftover === undefined
                            ? waited.value
                            : joined(leftover, waited.value)
                    leftover = undefined
                    const last = value.lastIndexOf(NEWLINE)
                    if (last === -1) {
                        leftover = value
                        continue
                    }
                    controller.enqueue(value.subarray(0, last + 1))
                    if (last + 1 < value.length)
                        leftover = value.subarray(last + 1)
                    sawLine = true
                }
            },
            cancel: (reason) => reader.cancel(reason),
        }),
        {
            status: answer.status,
            statusText: answer.statusText,
            headers: answer.headers,
        },
    )

    function hand(
        controller: ReadableStreamDefaultController<Uint8Array>,
    ): void {
        handed = true
        const token = park(
            new Response(rest, {
                headers: {
                    'content-type': answer.headers.get('content-type') ?? '',
                },
            }),
            run,
        )
        controller.enqueue(
            ENCODER.encode(`${JSON.stringify({ [CONTINUE_KEY]: token })}\n`),
        )
        controller.close()
    }
}

function joined(first: Uint8Array, second: Uint8Array): Uint8Array {
    const both = new Uint8Array(first.length + second.length)
    both.set(first)
    both.set(second, first.length)
    return both
}
