/*
Run `callback` once, in the first idle gap after the current frame — the client-side
trigger a deferred (inert-hydrated) region uses to wake itself: boot stays cheap (no
decode, no effects), then the region belatedly comes alive off the critical path,
before a human can act on it. `requestIdleCallback` when the runtime has it (a `timeout`
guarantees it fires even under sustained load); a `setTimeout(0)` macrotask otherwise
(Safari < 16.4, test DOMs), which still clears the boot frame. Returns a cancel to drop
the pending wake on teardown, so a region torn down before idle does no late work.
*/
export function whenIdle(callback: () => void, timeoutMs = 200): () => void {
    const globalWithIdle = globalThis as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
        cancelIdleCallback?: (handle: number) => void
    }
    if (typeof globalWithIdle.requestIdleCallback === 'function') {
        const handle = globalWithIdle.requestIdleCallback(callback, { timeout: timeoutMs })
        return () => globalWithIdle.cancelIdleCallback?.(handle)
    }
    const handle = setTimeout(callback, 0)
    return () => clearTimeout(handle)
}
