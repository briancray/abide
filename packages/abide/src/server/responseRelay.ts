// 38.14, 38.35, 38.36 — ONE RESPONSE, ANSWERED IN ONE PROCESS AND SENT FROM ANOTHER. `abide dev`'s
// listener holds the connection and its worker holds the app, so a request crosses as a message and
// its answer comes back as a head and then a chunk per pull. Both halves of that protocol are here —
// `serveOver` is the worker's, `askOver` the listener's — over a channel neither half knows the kind
// of, so the protocol is read in one file and runs in one test process (`responseRelay.test.ts`).
// What `serveDev` and `devWorker` keep is the processes and the sockets.

import { plainAnswer } from './plainAnswer.ts'

/** One direction of the line between the halves: bun's IPC in `abide dev`, a pair of queues in a test. */
export type Channel<Message> = { postMessage(message: Message): void }

/** A request as it crosses to the worker: its id, and what the worker rebuilds it from. */
export type Ask = {
    id: number
    method: string
    url: string
    headers: [string, string][]
    body: ArrayBuffer | null
}

/** What the listener's half sends: a request, and a pull or cancel of its body. */
export type ToRelay =
    | ({ kind: 'request' } & Ask)
    | { kind: 'pull'; id: number }
    | { kind: 'cancel'; id: number }

/** What the worker's half sends: a request's idle timeout set, and its head, each chunk, and its end. */
export type FromRelay =
    | { kind: 'timeout'; id: number; seconds: number }
    | {
          kind: 'head'
          id: number
          status: number
          statusText: string
          headers: [string, string][]
          empty: boolean
          /** 37.3 — whether the listener upgrades this request to the mux (`admitsMux`). */
          admitted: boolean
          /** A body whose length the answer declared, sent with its head rather than pulled. */
          whole: ArrayBuffer | undefined
      }
    | { kind: 'chunk'; id: number; bytes: ArrayBuffer }
    | { kind: 'end'; id: number }
    | { kind: 'fail'; id: number; message: string }

// A status whose response has no body to send, which `Response` refuses to be built with one.
const BODILESS = new Set([101, 204, 205, 304])

/** A throw, as the text a reader is shown: its stack where it has one. */
export function describe(thrown: unknown): string {
    return thrown instanceof Error
        ? (thrown.stack ?? thrown.message)
        : String(thrown)
}

/**
 * The worker's half: answers each request the listener sends with `fetch`, and its body a chunk per
 * pull. `take` is handed every `ToRelay` message; `timeout` sets a request's idle timeout where the
 * listener holds its connection (16.23); `hangUpAll` aborts every request still being answered.
 */
export function serveOver(
    channel: Channel<FromRelay>,
    answering: {
        fetch(request: Request): Promise<Response>
        /** 37.3 — whether the answer admits the request to the mux. */
        admits(request: Request, response: Response): boolean
        /** The answer to a throw out of `fetch`, which is an answer and not a dropped message. */
        failed(why: string): Response
        /** What a failure in the middle of an html body is shown as, appended to it. */
        failureMarkup(why: string): string
    },
) {
    // 38.96 — EACH REQUEST'S SIGNAL, by request id, until its answer ends: the listener holds the
    // connection, so a hang-up reaches the worker as a `cancel` rather than through bun.
    const hangUps = new Map<number, AbortController>()
    // Each answer whose head has gone out, by request id: what its chunks are read from, and whether a
    // failure in the middle can still be shown as markup.
    const bodies = new Map<
        number,
        { reader: ReadableStreamDefaultReader<Uint8Array>; html: boolean }
    >()
    // 16.23 — each request built here, known by the ask it was built from.
    const asks = new WeakMap<Request, number>()

    const ended = (id: number): void => {
        hangUps.delete(id)
        bodies.delete(id)
    }

    /**
     * Answers one request, sending back its head and holding its body for pulls.
     *
     * A THROW BEFORE THE HEAD IS AN ANSWER, not a dropped message. The listener is waiting on a head
     * for this id and nothing else will send one, so an escape left the reader's tab hanging until
     * they gave up.
     */
    async function answer(ask: Ask): Promise<void> {
        const hangUp = new AbortController()
        hangUps.set(ask.id, hangUp)
        const request = new Request(ask.url, {
            method: ask.method,
            headers: ask.headers,
            body: ask.body,
            signal: hangUp.signal,
        })
        asks.set(request, ask.id)
        let response: Response
        try {
            response = await answering.fetch(request)
        } catch (thrown) {
            response = answering.failed(describe(thrown))
        }
        const body = BODILESS.has(response.status) ? null : response.body
        // A DECLARED LENGTH IS A BODY ALREADY WHOLE, and it crosses with its head: re-streamed through
        // the listener, bun meets a first read that has to wait on the worker and answers it chunked,
        // dropping the length the app declared.
        const whole =
            body !== null && response.headers.has('content-length')
                ? await response.arrayBuffer()
                : undefined
        channel.postMessage({
            kind: 'head',
            id: ask.id,
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers.entries()],
            empty: body === null,
            admitted: answering.admits(request, response),
            whole,
        })
        if (body === null || whole !== undefined) {
            ended(ask.id)
            return
        }
        bodies.set(ask.id, {
            reader: body.getReader(),
            html: (response.headers.get('content-type') ?? '').startsWith(
                'text/html',
            ),
        })
    }

    /**
     * Sends the next chunk of an answer's body, or its end.
     *
     * ONE CHUNK PER ASK. A throw in the middle ends the stream in an error, as `abide start` does —
     * and where the answer is html a handler streams, what broke goes out as markup first, a reader
     * shown a blank tab otherwise being told nothing. A page is never here: it is built whole (41.1).
     */
    async function pull(id: number): Promise<void> {
        const reading = bodies.get(id)
        if (reading === undefined) return
        try {
            const { done, value } = await reading.reader.read()
            if (done) {
                ended(id)
                channel.postMessage({ kind: 'end', id })
                return
            }
            // THE VIEW'S OWN BYTES. A chunk may be a view on a buffer its producer still owns — a
            // compressor's `Buffer` is a slice of a shared pool, and `Buffer#slice` copies nothing —
            // so sending `value.buffer` sent the whole pool.
            const bytes = new Uint8Array(value).buffer as ArrayBuffer
            channel.postMessage({ kind: 'chunk', id, bytes })
        } catch (thrown) {
            ended(id)
            const why = describe(thrown)
            if (reading.html)
                channel.postMessage({
                    kind: 'chunk',
                    id,
                    bytes: new TextEncoder().encode(
                        answering.failureMarkup(why),
                    ).buffer as ArrayBuffer,
                })
            channel.postMessage({ kind: 'fail', id, message: why })
        }
    }

    return {
        take(message: ToRelay): Promise<void> | undefined {
            if (message.kind === 'request') return answer(message)
            if (message.kind === 'pull') return pull(message.id)
            const reading = bodies.get(message.id)
            hangUps.get(message.id)?.abort()
            ended(message.id)
            return reading?.reader.cancel()
        },
        timeout(request: Request, seconds: number): void {
            const id = asks.get(request)
            if (id !== undefined)
                channel.postMessage({ kind: 'timeout', id, seconds })
        },
        hangUpAll(): void {
            for (const hangUp of hangUps.values()) hangUp.abort()
        },
    }
}

// A request in flight: the request itself — because a worker replaced before it answered answers
// nothing, and the ask has to be put to the one that exists (38.24) — the channel it was asked over,
// and, once its head has come back, the stream the body is fed into and the pull waiting on the
// worker's next chunk (38.35).
type InFlight = {
    // 16.23 — the request bun handed the listener, which is the one its idle timeout is set on.
    request: Request
    headers: [string, string][]
    body: ArrayBuffer | null
    settle: (response: Response) => void
    asked: Channel<ToRelay> | undefined
    stream: ReadableStreamDefaultController<Uint8Array> | null
    pulled: (() => void) | null
    // A failure the worker sent behind a chunk still queued, raised on the pull after it — raising it
    // at once would discard the chunk, which is the markup saying what broke.
    failed: string | null
}

/**
 * The listener's half: asks each request of the worker on its channel, and settles it with the
 * response the worker's head and chunks describe. `take` is handed every `FromRelay` message;
 * `replace` points it at a worker's channel — there is none until the first — or at none while one
 * compiles; `endAll` ends what the worker that is gone was answering.
 */
export function askOver(
    setIdleTimeout: (request: Request, seconds: number) => void,
) {
    let channel: Channel<ToRelay> | undefined
    const inFlight = new Map<number, InFlight>()
    // ASKED BEFORE THERE IS ANYONE TO ASK. A replacement ends the worker and the next one does not
    // exist until its compile finishes, so a request arriving in that window waits here.
    const queued: InFlight[] = []
    // 37.3 — the answers the worker said `admitsMux`, which the listener upgrades on.
    const admitted = new WeakSet<Response>()
    let nextId = 0

    // NOT TRANSFERRED. Handing the buffer over detaches it here, and a request re-asked of the
    // replacement would post a body that is no longer there.
    function forward(waiting: InFlight): void {
        if (channel === undefined) {
            queued.push(waiting)
            return
        }
        nextId += 1
        const id = nextId
        waiting.asked = channel
        inFlight.set(id, waiting)
        channel.postMessage({
            kind: 'request',
            id,
            method: waiting.request.method,
            url: waiting.request.url,
            headers: waiting.headers,
            body: waiting.body,
        })
    }

    // 38.35, 38.36 — THE HEAD SETTLES THE RESPONSE, and its body pulls one chunk from the worker per
    // read the connection makes: a high-water mark of 0 asks for nothing ahead of the reader.
    function settleHead(
        id: number,
        waiting: InFlight,
        head: Extract<FromRelay, { kind: 'head' }>,
    ): void {
        const init = {
            status: head.status,
            statusText: head.statusText,
            headers: head.headers,
        }
        if (head.empty || head.whole !== undefined) {
            inFlight.delete(id)
            const answered = new Response(head.whole ?? null, init)
            // The admission has no body, so an admitted answer is always settled here.
            if (head.admitted) admitted.add(answered)
            waiting.settle(answered)
            return
        }
        const asked = waiting.asked
        const body = new ReadableStream<Uint8Array>(
            {
                start(controller) {
                    waiting.stream = controller
                },
                pull(controller) {
                    if (waiting.failed !== null) {
                        inFlight.delete(id)
                        controller.error(new Error(waiting.failed))
                        return
                    }
                    return new Promise<void>((done) => {
                        waiting.pulled = done
                        asked?.postMessage({ kind: 'pull', id })
                    })
                },
                cancel() {
                    inFlight.delete(id)
                    asked?.postMessage({ kind: 'cancel', id })
                },
            },
            { highWaterMark: 0 },
        )
        waiting.settle(new Response(body, init))
    }

    return {
        /**
         * The worker's answer to `request`.
         *
         * A REQUEST AS A MESSAGE. `Request` does not survive a structured clone, so what crosses is
         * what the worker rebuilds one from — and the body is collected ONCE, HERE, which is what lets
         * it be asked again of a replacement (38.24): a body can only be read off a `Request` once.
         */
        async ask(request: Request): Promise<Response> {
            const body =
                request.body === null ? null : await request.arrayBuffer()
            return await new Promise<Response>((settle) => {
                forward({
                    request,
                    headers: identityOnly(request.headers),
                    body,
                    settle,
                    asked: undefined,
                    stream: null,
                    pulled: null,
                    failed: null,
                })
            })
        },
        /** Whether the worker admitted this answer's request to the mux. 37.3. */
        admitted(response: Response): boolean {
            return admitted.has(response)
        },
        take(message: FromRelay): void {
            const waiting = inFlight.get(message.id)
            if (waiting === undefined) return
            if (message.kind === 'timeout') {
                setIdleTimeout(waiting.request, message.seconds)
                return
            }
            if (message.kind === 'head') {
                settleHead(message.id, waiting, message)
                return
            }
            const stream = waiting.stream
            const pulled = waiting.pulled
            waiting.pulled = null
            if (stream === null) return
            if (message.kind === 'chunk')
                stream.enqueue(new Uint8Array(message.bytes))
            else if (message.kind === 'end') {
                inFlight.delete(message.id)
                stream.close()
            } else waiting.failed = message.message
            pulled?.()
        },
        /** Asks the worker on `next` from now on — every request that waited for one included. */
        replace(next: Channel<ToRelay> | undefined): void {
            channel = next
            if (next === undefined) return
            for (const again of queued.splice(0)) forward(again)
        },
        /**
         * Ends what a worker that is gone was answering. A request whose head has not gone out is
         * asked again of the next (38.24) where `reask`, and answered 500 where not — the request in
         * hand may be what ended the app (38.41). 38.37 — one whose head has gone out cannot be
         * answered again, and ends as `abide start`'s does.
         */
        endAll(why: string, reask: boolean): void {
            for (const held of inFlight.values()) {
                if (held.stream !== null) {
                    held.stream.error(new Error(why))
                    held.pulled?.()
                } else if (reask) queued.push(held)
                else held.settle(plainAnswer(why, 500))
            }
            inFlight.clear()
        },
    }
}

// 38.38 — ASKED WITHOUT `accept-encoding`, so the app answers uncompressed. A failure after the head
// is shown as markup appended to the stream, and markup appended to a compressed stream is a stream
// no browser can decode. Localhost buys nothing from the bytes saved.
function identityOnly(headers: Headers): [string, string][] {
    const kept: [string, string][] = []
    for (const [name, value] of headers)
        if (name !== 'accept-encoding') kept.push([name, value])
    return kept
}
