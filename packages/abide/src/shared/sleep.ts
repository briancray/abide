/**
 * Waits `ms`, or rejects with `ended`'s reason where it aborts first — clearing its timer, so an
 * aborted wait holds nothing. A retry's wait between attempts, on either side (`retryWait`).
 */
export function sleep(ms: number, ended: AbortSignal): Promise<void> {
    return new Promise((woke, refused) => {
        if (ended.aborted) {
            refused(ended.reason)
            return
        }
        const leave = (): void => {
            clearTimeout(timer)
            refused(ended.reason)
        }
        const timer = setTimeout(() => {
            ended.removeEventListener('abort', leave)
            woke()
        }, ms)
        ended.addEventListener('abort', leave, { once: true })
    })
}
