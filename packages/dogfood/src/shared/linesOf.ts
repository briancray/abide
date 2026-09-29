/**
 * The lines `body` carries, each as it lands, the last one whether or not a newline ends it.
 *
 * A reader rather than `for await`, which not every engine a reader brings iterates a body with.
 */
export async function* linesOf(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
    const decoder = new TextDecoder()
    let buffered = ''
    const reader = body.getReader()
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffered += decoder.decode(value, { stream: true })
        let newline = buffered.indexOf('\n')
        while (newline !== -1) {
            yield buffered.slice(0, newline)
            buffered = buffered.slice(newline + 1)
            newline = buffered.indexOf('\n')
        }
    }
    buffered += decoder.decode()
    if (buffered !== '') yield buffered
}
