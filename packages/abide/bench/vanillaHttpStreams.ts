// THE HTTP ARM, hand-written: one jsonl response per stream, which is what `wire`'s `streamed`
// reads today (16.32). Each open stream is one HTTP/1.1 connection for as long as it is read.

/** The server half: `/stream?n=` answers `n` jsonl lines, one per tick. */
export function httpStreamServer(): (request: Request) => Response {
    return (request) => {
        const count = Number(new URL(request.url).searchParams.get('n'))
        let sent = 0
        return new Response(
            new ReadableStream({
                async pull(controller) {
                    if (sent === count) return controller.close()
                    await Bun.sleep(1)
                    controller.enqueue(`${JSON.stringify({ at: sent++ })}\n`)
                },
            }),
            { headers: { 'content-type': 'application/x-ndjson' } },
        )
    }
}

/** The client half: every line of one stream, parsed, as it lands. */
export async function* httpStream(
    origin: string,
    count: number,
): AsyncGenerator<unknown> {
    const response = await fetch(`${origin}/stream?n=${count}`)
    const decoder = new TextDecoder()
    let held = ''
    for await (const bytes of response.body as ReadableStream<Uint8Array>) {
        held += decoder.decode(bytes, { stream: true })
        let end = held.indexOf('\n')
        while (end !== -1) {
            yield JSON.parse(held.slice(0, end))
            held = held.slice(end + 1)
            end = held.indexOf('\n')
        }
    }
}
