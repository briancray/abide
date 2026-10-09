/**
 * The lines `body` carries, each as it lands, the last one whether or not a newline ends it.
 *
 * The relay's pairing stream and the claude child's stdout. Its own rather than the docs app's
 * `linesOf`: this CLI ships without the docs app, and abide exports no line reader of its own.
 */
export async function* readLines(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
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
            while (newline !== -1) {
                yield buffered.slice(0, newline)
                buffered = buffered.slice(newline + 1)
                newline = buffered.indexOf('\n')
            }
            if (done) {
                if (buffered !== '') yield buffered
                return
            }
        }
    } finally {
        void reader.cancel().catch(() => {})
    }
}
