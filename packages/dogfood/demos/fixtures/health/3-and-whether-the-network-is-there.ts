import { online } from 'abide'

/**
 * The other REACTIVE ambient, and reactive for the reason `route()` is: connectivity changes without a
 * new caller arriving, so a probe that answered only on the next ask would leave a banner up after the
 * network came back.
 *
 * `health()` is what the app says about ITSELF; this is whether anything can reach it to ask.
 */
export function shouldShowOfflineBanner(): boolean {
    return !online()
}
