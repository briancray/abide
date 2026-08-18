import { log } from 'abide'
import { onStart, onStop } from 'abide/server'

/**
 * An ONION rather than a pair of before/after hooks: everything above `await start()` happens before the
 * socket exists, so an app cannot answer a request against setup that has not finished. A
 * `beforeStart` / `afterStart` pair cannot promise that — nothing makes the second wait for the first.
 */
onStart(async (start) => {
    log('warming')
    await start()
    log('listening')
})

/** And the mirror on the way out. `stop()` is the socket closing; what follows it is the drain. */
onStop(async (stop) => {
    log('draining')
    await stop()
})
