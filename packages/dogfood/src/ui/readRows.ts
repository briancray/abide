import { isRunnerFailure, type RunnerFailure } from 'harness/rows'

// A RUN'S ROWS, AS EACH ONE LANDS, read off `rpc.raw`'s `Response` — one JSON row per line, each
// handed to `each` once. The call's own value streams and takes a signal too (16.33, 16.53), but it
// is the ACCUMULATION: a board merging rows into results it already holds would walk the whole of
// it again for every row that landed.
export async function readRows<Row>(
    response: Response,
    each: (row: Row) => void,
): Promise<void> {
    if (!response.ok || response.body === null)
        throw new Error(`${response.status} ${await response.text()}`)
    const decoder = new TextDecoder()
    let buffered = ''
    // A reader rather than `for await`, which not every engine a reader brings iterates a body with.
    const reader = response.body.getReader()
    for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        buffered += decoder.decode(value, { stream: true })
        let newline = buffered.indexOf('\n')
        while (newline !== -1) {
            const line = buffered.slice(0, newline)
            buffered = buffered.slice(newline + 1)
            if (line === '') continue
            const row = JSON.parse(line) as Row | RunnerFailure
            if (isRunnerFailure(row as object))
                throw new Error((row as RunnerFailure).failure)
            each(row as Row)
            newline = buffered.indexOf('\n')
        }
    }
}
