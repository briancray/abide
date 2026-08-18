import { GET, jsonl } from 'abide/server'

/**
 * The same framing as `answer-with-many`, with a PAUSE between rows.
 *
 * Which is the whole of what a template loop shows that a collected one does not: the page is
 * complete after every row rather than after the last, so a reader watches the list grow instead of
 * waiting on a source that has not finished. A generator that yields without ever suspending cannot
 * demonstrate it — every row lands in the same turn and the rung looks like a plain `{#for}`.
 */
async function* items(): AsyncGenerator<{ id: number }> {
    for (let id = 1; id <= 5; id++) {
        await Bun.sleep(150)
        yield { id }
    }
}

export const arriving = GET(() => jsonl(items()))
