/**
 * What a browser runs on an answer carrying `PRINCIPAL_HEADER`: the principal's reload.
 *
 * `undefined` until something reads `principal`, so a page that never does pays one
 * property read per answer and nothing else. A leaf because the principal fills it and the fetch
 * every call is made through runs it, and that fetch reaching for the principal itself would put it
 * in every page that calls a handler.
 */
export const PRINCIPAL_ROTATED: { current: (() => void) | undefined } = {
    current: undefined,
}
