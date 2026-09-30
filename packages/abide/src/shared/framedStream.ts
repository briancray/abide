/**
 * A framed body's chunks, yielded as each line completes: the whole line where `prefix` is `''`
 * (jsonl), the `data:` line of each event where it is `'data: '` (sse). A line that does not carry
 * the prefix — an sse `event:` line, a blank line — is skipped.
 *
 * Cancelled when the reader stops reading — a refresh starts a new run and the old one's reader has
 * nothing left to hand anything.
 */
export async function* framedStream(
    body: ReadableStream<Uint8Array>,
    prefix: string | null,
): AsyncGenerator<unknown> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            buffered += done
                ? decoder.decode()
                : decoder.decode(value, { stream: true })
            let newline = buffered.indexOf('\n')
            while (newline !== -1 || (done && buffered !== '')) {
                const end = newline === -1 ? buffered.length : newline
                const line = buffered.slice(0, end)
                buffered = buffered.slice(end + 1)
                if (line !== '' && line.startsWith(prefix ?? ''))
                    yield JSON.parse(line.slice((prefix ?? '').length))
                newline = buffered.indexOf('\n')
            }
            if (done) return
        }
    } finally {
        void reader.cancel().catch(() => {})
    }
}
