import { log } from 'abide'

/**
 * An ONION rather than a pair of before/after hooks: everything above `await start()` happens before the
 * socket exists, so an app cannot answer a request against setup that has not finished. A
 * `beforeStart` / `afterStart` pair cannot promise that — nothing makes the second wait for the first.
 */
export async function onStart(start: () => Promise<void>): Promise<void> {
    log('warming')
    await start()
    log('listening')
}

/** And the mirror on the way out. `stop()` is the socket closing; what follows it is the drain. */
export async function onStop(stop: () => Promise<void>): Promise<void> {
    log('draining')
    await stop()
}
