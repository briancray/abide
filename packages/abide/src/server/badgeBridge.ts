// 38.188 — THE BADGING API, IN EVERY PAGE THE NATIVE APP SHOWS: `navigator.setAppBadge` and
// `navigator.clearAppBadge` as the standard has them, carried to the Dock icon.
//
// SERIALIZED, not imported: `openNativeWindow` hands its source to a `WKUserScript`, so the
// function closes over nothing and every name it reads is the page's own.

/** Posts the badge's label to the `abideBadge` handler: digits, `flag`, or `''` for none. */
export function badgeBridge(): void {
    const handler = (
        globalThis as {
            webkit?: {
                messageHandlers?: {
                    abideBadge?: { postMessage(message: string): void }
                }
            }
        }
    ).webkit?.messageHandlers?.abideBadge
    if (handler === undefined) return

    // `[EnforceRange] unsigned long long`: truncated, and a TypeError where it is not finite or
    // falls outside the range.
    const setAppBadge = (contents?: number): Promise<void> => {
        if (contents === undefined) {
            handler.postMessage('flag')
            return Promise.resolve()
        }
        const count = Math.trunc(Number(contents))
        if (
            !Number.isFinite(count) ||
            count < 0 ||
            count > Number.MAX_SAFE_INTEGER
        )
            return Promise.reject(
                new TypeError(`${contents} is not a badge count`),
            )
        handler.postMessage(count === 0 ? '' : String(count))
        return Promise.resolve()
    }
    const clearAppBadge = (): Promise<void> => setAppBadge(0)
    Object.defineProperty(navigator, 'setAppBadge', {
        value: setAppBadge,
        configurable: true,
        writable: true,
    })
    Object.defineProperty(navigator, 'clearAppBadge', {
        value: clearAppBadge,
        configurable: true,
        writable: true,
    })
}
