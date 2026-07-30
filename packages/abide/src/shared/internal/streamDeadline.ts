// A STREAMING RUN'S IDLE CLOCK (ADR 0028 D1) — time without PROGRESS, not time to finish.
//
// One timer for the whole stream, restarted in place on every chunk, so a healthy stream runs for hours
// and a stalled one trips at `ms`. `unref` so a stream awaiting its next chunk never by itself holds the
// process open (which would break `abide run` and any short-lived script). `ms` of 0 arms nothing and
// hands back inert no-ops, so an unbounded stream pays neither the timer nor a branch per chunk.
//
// It lives here, with the timer factory as a PARAMETER, because of what its own comment records: this is
// isomorphic code, and `Timeout.refresh()` is a Node/Bun method. In the browser `setTimeout` returns a
// number, `timer.refresh()` throws, the throw lands in the stream pump's catch, and the whole transcript
// fails on a per-chunk cause. No unit test saw that — happy-dom deletes `window`, so `bun test` takes the
// server path either way — and the docs-app e2e suite is what caught it. A branch that only an e2e can
// reach is a branch that gets broken again, so the substrate is now something a test can choose.
//
// The capability is probed ONCE per stream rather than per chunk, and each branch stays monomorphic.

export interface StreamDeadline {
    // A chunk arrived: restart the window.
    progress(): void
    // The stream settled (or was abandoned): stop the clock.
    cancel(): void
}

// What the clock needs from its substrate. A handle is opaque — `refresh`/`unref` are probed, never
// required — which is exactly the difference between the two substrates.
export interface StreamTimerHandle {
    refresh?(): void
    unref?(): void
}

export interface StreamTimers {
    set(onIdle: () => void, ms: number): StreamTimerHandle | number
    clear(handle: StreamTimerHandle | number): void
}

// The ambient pair. Written as a module constant so the parameter's default costs one property load at
// arm time rather than a closure per stream.
export const AMBIENT_STREAM_TIMERS: StreamTimers = {
    set: (onIdle, ms) => setTimeout(onIdle, ms),
    clear: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
}

const INERT_STREAM_DEADLINE: StreamDeadline = {
    progress: (): void => {},
    cancel: (): void => {},
}

export function armStreamDeadline(
    ms: number,
    onIdle: () => void,
    timers: StreamTimers = AMBIENT_STREAM_TIMERS,
): StreamDeadline {
    if (!Number.isFinite(ms) || ms <= 0) return INERT_STREAM_DEADLINE
    let timer = timers.set(onIdle, ms)
    if (typeof timer !== 'number') timer.unref?.()
    // `refresh()` restarts a timer IN PLACE — no allocation per chunk on a hot stream. Where it does not
    // exist, clear-and-re-set is the equivalent, and calling it blindly is what broke a whole stream.
    const refreshable = typeof timer === 'object' && typeof timer.refresh === 'function'
    return {
        progress: refreshable
            ? () => {
                  // Called UNCONDITIONALLY, not `refresh?.()`: the probe above is the guard, and an
                  // optional call here would turn "this substrate cannot restart in place" from a loud
                  // TypeError into a window that silently never restarts — which trips a HEALTHY stream
                  // at `ms` instead of failing the pump. Loud is the better of the two, and the probe
                  // means neither happens.
                  ;(timer as StreamTimerHandle & { refresh(): void }).refresh()
              }
            : () => {
                  timers.clear(timer)
                  timer = timers.set(onIdle, ms)
              },
        cancel: () => {
            timers.clear(timer)
        },
    }
}
