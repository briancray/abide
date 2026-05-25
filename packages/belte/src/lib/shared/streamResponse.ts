import { decodeResponse } from './decodeResponse.ts'
import { HttpError } from './HttpError.ts'
import { parseJsonlStream } from './parseJsonlStream.ts'
import { parseSseStream } from './parseSseStream.ts'

type Slot<T> = { kind: 'value'; value: T } | { kind: 'done' } | { kind: 'error'; error: Error }

/*
Iterates a Response as an AsyncIterable<Frame>. Dispatches by
Content-Type:
  text/event-stream                          → parseSseStream
  application/jsonl, application/x-ndjson    → parseJsonlStream
  anything else                              → yields the single
                                               decoded body once

Non-2xx Responses throw HttpError before the first yield. This is the
runtime behind `RemoteFunction.stream(args)`; openSubscriptionStream's
HTTP path also rides on top of it so the Content-Type → parser
mapping lives in exactly one place.

The parsers run callback-style internally; a tiny mailbox bridges
them to the generator interface (push into a buffer when no consumer
is waiting, hand off directly when one is). Cancellation through
`return()` cancels the underlying reader, which propagates through
fetch into a network-level abort on the server.
*/
export async function* streamResponse(responsePromise: Promise<Response>): AsyncGenerator<unknown> {
    const response = await responsePromise
    if (!response.ok) {
        throw new HttpError(response)
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    const parser =
        response.body && contentType.startsWith('text/event-stream')
            ? parseSseStream
            : response.body &&
                (contentType.startsWith('application/jsonl') ||
                    contentType.startsWith('application/x-ndjson'))
              ? parseJsonlStream
              : undefined
    if (!parser || !response.body) {
        yield await decodeResponse(response)
        return
    }
    const reader = response.body.getReader()
    const buffer: Slot<unknown>[] = []
    let waiter: ((slot: Slot<unknown>) => void) | undefined
    function push(slot: Slot<unknown>): void {
        if (waiter) {
            const wake = waiter
            waiter = undefined
            wake(slot)
            return
        }
        buffer.push(slot)
    }
    parser(reader, {
        onFrame: (value) => push({ kind: 'value', value }),
        onError: (error) => push({ kind: 'error', error }),
        onDone: () => push({ kind: 'done' }),
    })
    try {
        while (true) {
            const slot =
                buffer.shift() ??
                (await new Promise<Slot<unknown>>((resolve) => (waiter = resolve)))
            if (slot.kind === 'done') {
                return
            }
            if (slot.kind === 'error') {
                throw slot.error
            }
            yield slot.value
        }
    } finally {
        reader.cancel().catch(() => undefined)
    }
}
