type Callbacks = {
    onFrame(value: unknown): void
    onError(error: Error): void
    onDone(): void
}

/*
Drains a ReadableStream<Uint8Array> shaped as Server-Sent Events
(text/event-stream) and forwards each event as a frame. Events are
delimited by a blank line; within an event, `data:` lines accumulate
into the frame payload (parsed as JSON), `event:` sets the event type,
and `:` lines are comments (used as keepalives — see the producer in
`belte/response/sse`).

The `event: error` convention from the producer is recognised here and
surfaced through onError as a terminal failure. Other event types
(including unknown ones) flow through onFrame undifferentiated — the
consumer's contract is "a stream of frames"; bespoke typing would
require a parallel callback API the streaming use cases don't justify.

Both `\n\n` and `\r\n\r\n` event terminators are tolerated by
normalising `\r\n` to `\n` upfront, so producers other than belte's own
helper still parse correctly.
*/
export async function parseSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    callbacks: Callbacks,
): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                callbacks.onDone()
                return
            }
            buffer = (buffer + decoder.decode(value, { stream: true })).replaceAll('\r\n', '\n')
            let separator = buffer.indexOf('\n\n')
            while (separator !== -1) {
                const block = buffer.slice(0, separator)
                buffer = buffer.slice(separator + 2)
                if (handleEvent(block, callbacks)) {
                    return
                }
                separator = buffer.indexOf('\n\n')
            }
        }
    } catch (error) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    }
}

function handleEvent(block: string, callbacks: Callbacks): boolean {
    let eventType = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
        if (line.length === 0 || line.startsWith(':')) {
            continue
        }
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const rawValue = colon === -1 ? '' : line.slice(colon + 1)
        const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
        if (field === 'event') {
            eventType = value
        } else if (field === 'data') {
            dataLines.push(value)
        }
    }
    if (dataLines.length === 0) {
        return false
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(dataLines.join('\n'))
    } catch {
        return false
    }
    if (eventType === 'error') {
        const message =
            parsed && typeof parsed === 'object' && 'message' in parsed
                ? String((parsed as { message: unknown }).message)
                : 'sse error'
        callbacks.onError(new Error(message))
        return true
    }
    callbacks.onFrame(parsed)
    return false
}
