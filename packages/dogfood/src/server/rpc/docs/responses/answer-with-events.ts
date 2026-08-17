import { GET, sse } from 'abide/server'

/**
 * The same async iterable, framed as server-sent events instead — `data: …` per record, which is
 * what an `EventSource` in a browser reads with no parsing of your own.
 *
 * One source, two framings, and the handler is unchanged between this rung and the one above it:
 * which one a route uses is a question about the CLIENT, not about the work.
 */
async function* items(): AsyncGenerator<{ id: number }> {
    for (let id = 1; id <= 3; id++) yield { id }
}

export const catalogue = GET(() => sse(items()))
