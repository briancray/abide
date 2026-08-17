import { memo } from 'abide'
import { GET } from 'abide/server'

/** How many times the body below has actually run, for the whole process. */
let ran = 0

/**
 * Per-caller, by default — which is the only default a server can have: this is declared once at module
 * scope and two requests in flight have two caches, neither able to read the other's.
 */
const basket = memo(async () => ({ builtOnRun: ++ran }))

/**
 * Read TWICE in one request, which is what makes the two numbers mean something: they are equal, so
 * the second read inside a request is the cache — and pressing the button again raises both, because
 * the next request brought a cache of its own.
 */
export const readTwice = GET(async () => {
    const first = await basket()
    const second = await basket()
    return { first: first.builtOnRun, second: second.builtOnRun, ranSoFar: ran }
})
