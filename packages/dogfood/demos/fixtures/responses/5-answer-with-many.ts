import { GET, jsonl } from 'abide/server'

/**
 * Many objects, one JSON document per line, sent AS THEY ARRIVE rather than collected first — so a
 * reader starts on the first row while the source is still producing the last.
 *
 * The argument is any async iterable, which is what makes the handler an ordinary generator: nothing
 * here knows it is being streamed.
 */
async function* items(): AsyncGenerator<{ id: number }> {
    for (let id = 1; id <= 3; id++) yield { id }
}

export const catalogue = GET(() => jsonl(items()))
