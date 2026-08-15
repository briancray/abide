import { config } from 'abide/server'

/**
 * All three ceilings are unset by default, and that is the design rather than an omission: a ceiling
 * nobody declared has to cost nothing, so each is read exactly where it could first matter and no path
 * between them charges anything for the ones that are off. The render budget does not even arm a timer.
 */
export function nothingDeclared(): boolean {
    const settings = config()
    return (
        settings.ABIDE_MAX_GLOBAL_CACHE_SIZE === Number.POSITIVE_INFINITY &&
        settings.ABIDE_MAX_STREAM_BUFFER_SIZE === Number.POSITIVE_INFINITY
    )
}
