/**
 * A timer that survives neither a request nor a process exit on its own account.
 *
 * `unref` where the runtime has it: a window that has not closed yet is not a reason for a server to
 * stay up, and a test that ends with one armed should still end. One spelling, because the cast is
 * the kind of thing that gets copied and then fixed in only one of its copies.
 */
export function arm(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(fn, ms)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    return timer
}

/** No deadline. What every limit in abide answers when nothing declared one. */
export const NO_LIMIT = Infinity

/**
 * The one failure a deadline produces, so `AbideTimeoutError` is spelled in one place.
 *
 * Built ahead of the race rather than inside the timer: a caller that never runs out has paid for
 * one message it did not need, and a caller that does gets a stack from where the deadline was
 * declared rather than from a timer callback with nothing above it.
 */
export function timeoutError(subject: string, what: string, limit: number): Error {
    const failure = new Error(`abide: ${subject} ${what} within ${limit}ms`)
    failure.name = 'AbideTimeoutError'
    return failure
}

/**
 * `promise`, or `failure` once `limit` is up — whichever lands first.
 *
 * The timer is cleared on both settle paths, so a finished race is not a reason for a process to
 * stay up any longer than `arm` already declines to be.
 */
export function race<V>(promise: PromiseLike<V>, limit: number, failure: Error): Promise<V> {
    return new Promise<V>((resolve, reject) => {
        const timer = arm(() => reject(failure), limit)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error: unknown) => {
                clearTimeout(timer)
                reject(error as Error)
            },
        )
    })
}
