import { memo } from 'abide'
import { GET } from 'abide/server'

let ran = 0

/**
 * `{ global }` — one cache for the whole process.
 *
 * Correct here because the answer does not depend on who asked: a currency table is the same table for
 * everybody, and a per-caller cache would fetch it once per request forever.
 */
const currencies = memo(async () => ({ builtOnRun: ++ran }), { global: true })

/**
 * The same two reads as the rung above, and the difference is what happens on the SECOND press: the
 * number stays where it was, because the request that follows finds the cache the last one filled.
 */
export const readTwice = GET(async () => {
    const first = await currencies()
    const second = await currencies()
    return { first: first.builtOnRun, second: second.builtOnRun, ranSoFar: ran }
})
