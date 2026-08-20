import { config, GET } from 'abide/server'

/**
 * All three ceilings are unset by default, and that is the design rather than an omission: a ceiling
 * nobody declared has to cost nothing, so each is read exactly where it could first matter and no path
 * between them charges anything for the ones that are off. The render budget does not even arm a timer.
 *
 * `Infinity` does not survive JSON, so what crosses the wire is the word — which is also the honest
 * thing to show a reader: "unset" is the state, and a number would be a value somebody chose.
 */
export const asShipped = GET(() => {
    const settings = config()
    const say = (ceiling: number): string =>
        ceiling === Number.POSITIVE_INFINITY ? 'unset' : String(ceiling)
    return {
        ABIDE_MAX_GLOBAL_CACHE_SIZE: say(settings.ABIDE_MAX_GLOBAL_CACHE_SIZE),
        ABIDE_MAX_STREAM_BUFFER_SIZE: say(settings.ABIDE_MAX_STREAM_BUFFER_SIZE),
    }
})
