import { onError } from 'abide/server'

/**
 * The fourth hook, and the only one that runs on a path nobody planned.
 *
 * It answers rather than logs-and-rethrows: what it returns IS the response, so an app decides what a
 * caller sees. Returning nothing falls through to abide's own answer, which is the right arm for the
 * errors this hook was not written for.
 */
onError((thrown) => {
    if (thrown instanceof RangeError) {
        return new Response('that number is out of range', { status: 400 })
    }
    return undefined
})
