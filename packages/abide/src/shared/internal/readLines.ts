// Newline-framed lines off a byte stream — the one implementation.
//
// This loop was hand-written at three sites (`lineReader` over stdin, `callCliCommand` over a streaming
// RPC body, `logsCommand` over the SSE log feed), character-for-character identical in the part that is
// easy to get wrong and different only in what each did with a line. The subtle half is the decoder:
// `decode(chunk, { stream: true })` holds a partial multi-byte sequence back until the continuation
// byte arrives, and the final argless `decode()` flushes it. Three copies is three chances to drop that
// second call and truncate the last line of a UTF-8 stream — which is invisible in ASCII tests.
//
// Lines are yielded RAW: no trimming, no empty-line filtering. A caller that wants `trimEnd()` (the two
// CLI readers, because a `\r\n` stream would otherwise carry the `\r` into rendered output) or wants to
// skip blanks does it per line, because those are presentation choices and they genuinely differ. The
// one framing decision made here is the TAIL: a trailing fragment with no terminating newline is
// yielded, an empty one is not — so a well-formed stream ending in `\n` does not emit a phantom final
// line, and a stream whose last line is unterminated does not lose it.
//
// `decodeStreamResponse` deliberately does NOT use this: its `sse` half frames on BLANK LINES (`\n\n`),
// not newlines, so line-framing is the wrong unit there and forcing it through would be a unification
// in name only.
export async function* readLines(
    input: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<string> {
    const decoder = new TextDecoder()
    let buffered = ''
    for await (const chunk of input as AsyncIterable<Uint8Array>) {
        buffered += decoder.decode(chunk, { stream: true })
        let newline = buffered.indexOf('\n')
        while (newline !== -1) {
            yield buffered.slice(0, newline)
            buffered = buffered.slice(newline + 1)
            newline = buffered.indexOf('\n')
        }
    }
    buffered += decoder.decode()
    if (buffered.length > 0) yield buffered
}
