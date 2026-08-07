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
