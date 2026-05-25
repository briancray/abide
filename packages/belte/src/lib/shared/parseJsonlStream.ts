type Callbacks = {
    onFrame(value: unknown): void
    onError(error: Error): void
    onDone(): void
}

/*
Drains a ReadableStream<Uint8Array> shaped as JSON Lines
(application/jsonl) — one JSON value per line, terminated by `\n` — and
forwards each parsed line as a frame. Mirrors the producer side in
`belte/respond/jsonl`: a final `{"$error":"<message>"}` line is
treated as a terminal error and surfaced through onError; everything
else flows through onFrame.

Malformed lines are skipped silently so a single corrupted frame
doesn't tear down the whole stream — the consumer's higher-level
contract is "frames may be lossy"; if the producer cared it would have
used a length-prefixed framing instead.
*/
export async function parseJsonlStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    callbacks: Callbacks,
): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                const trailing = buffer.trim()
                if (trailing.length > 0) {
                    handleLine(trailing, callbacks)
                }
                callbacks.onDone()
                return
            }
            buffer += decoder.decode(value, { stream: true })
            let newline = buffer.indexOf('\n')
            while (newline !== -1) {
                const line = buffer.slice(0, newline)
                buffer = buffer.slice(newline + 1)
                if (line.trim().length > 0) {
                    if (handleLine(line, callbacks)) {
                        return
                    }
                }
                newline = buffer.indexOf('\n')
            }
        }
    } catch (error) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    }
}

function handleLine(line: string, callbacks: Callbacks): boolean {
    let parsed: unknown
    try {
        parsed = JSON.parse(line)
    } catch {
        return false
    }
    if (parsed && typeof parsed === 'object' && '$error' in parsed) {
        const err = (parsed as { $error: unknown }).$error
        callbacks.onError(new Error(typeof err === 'string' ? err : 'jsonl error'))
        return true
    }
    callbacks.onFrame(parsed)
    return false
}
