import { GET, sse } from 'abide/server'

/**
 * The same events again, for the reader that is not a stub.
 *
 * `sse()` exists because the address is one ANYTHING can read, and the rung beside this one proves
 * only half of that: a stub reading its own endpoint would be just as happy with `jsonl`. This is
 * the other half — an `EventSource`, which is the browser's own client for this framing and knows
 * nothing about abide.
 *
 * A ticker rather than three values at once, because what an `EventSource` is FOR is arrival: a
 * consumer that only ever saw a completed body could have fetched it.
 */
async function* ticks(): AsyncGenerator<{ at: number }> {
    for (let at = 1; at <= 5; at++) {
        await Bun.sleep(300)
        yield { at }
    }
}

export const feed = GET(() => sse(ticks()))
