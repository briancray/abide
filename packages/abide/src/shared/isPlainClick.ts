/**
 * Whether a click is an unmodified primary click the app may take.
 *
 * A MODIFIED CLICK IS THE READER ASKING THE BROWSER, not the app: ctrl/cmd opens a tab, shift a
 * window, alt downloads. Taking those is the single most complained-about thing a client router
 * does, and it is four fields. A click something already took is not the app's either.
 */
export function isPlainClick(event: MouseEvent): boolean {
    return (
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.defaultPrevented
    )
}
