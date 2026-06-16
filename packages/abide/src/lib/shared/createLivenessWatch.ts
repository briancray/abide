/*
The liveness state machine shared by every "is that server still there?"
consumer: a recursive timer (never setInterval, so a slow probe can't overlap
the next) runs `probe(url)`; a success resets the miss count, `failureLimit`
consecutive misses declare the target down. Two modes by which hook is given:

- `onLost` (terminal): the bundle launcher's mode — down fires onLost once
  and the watch stops; the user reconnects deliberately.
- `onChange` (continuous): the client health() mode — down fires
  onChange(false), polling continues, and the first subsequent success fires
  onChange(true). Transitions only, never per-poll — except the first success
  after watch(), which always reports so a consumer that kept state across a
  stop()/watch() cycle (health's backendAlive) resyncs with the machine.

watch(url) (re)starts against a new target (first probe after one interval —
probeNow() forces an immediate one); a probe resolving after the target
changed is discarded (the url capture is the staleness guard). Probe
transport is injected — the launcher passes the identity-endpoint check, the
client health() a browser fetch — so the machine is side-neutral.
*/
export function createLivenessWatch(options: {
    probe: (url: string) => Promise<boolean>
    onLost?: (url: string) => void
    onChange?: (alive: boolean) => void
    intervalMs?: number
    failureLimit?: number
}): {
    watch: (url: string) => void
    stop: () => void
    probeNow: () => void
} {
    const intervalMs = options.intervalMs ?? 4000
    const failureLimit = options.failureLimit ?? 2
    let watchedUrl: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let failures = 0
    let alive = true
    /* No verdict reported since watch() — makes the first success always report. */
    let fresh = true

    async function runProbe(): Promise<void> {
        const url = watchedUrl
        if (!url) {
            return
        }
        if (inFlight) {
            /*
            A stale probe from a previous target is still awaiting. Keep this
            watch's timer armed — the stale resolution discards itself without
            rescheduling, so returning bare here would leave no timer and the
            new target silently unwatched.
            */
            timer = setTimeout(runProbe, intervalMs)
            return
        }
        inFlight = true
        const up = await options.probe(url)
        inFlight = false
        // A stop or re-watch during the await moved the target — discard.
        if (watchedUrl !== url) {
            return
        }
        if (up) {
            failures = 0
            if (!alive || fresh) {
                alive = true
                fresh = false
                options.onChange?.(true)
            }
        } else {
            failures += 1
            if (failures >= failureLimit && alive) {
                alive = false
                fresh = false
                if (options.onChange) {
                    options.onChange(false)
                } else {
                    stop()
                    options.onLost?.(url)
                    return
                }
            }
        }
        timer = setTimeout(runProbe, intervalMs)
    }

    function watch(url: string): void {
        stop()
        watchedUrl = url
        fresh = true
        timer = setTimeout(runProbe, intervalMs)
    }

    function stop(): void {
        if (timer) {
            clearTimeout(timer)
            timer = undefined
        }
        watchedUrl = undefined
        failures = 0
        alive = true
    }

    /* Event-accelerated check (visibility return, online event): probe immediately instead of waiting out the interval. */
    function probeNow(): void {
        if (!watchedUrl || inFlight) {
            return
        }
        if (timer) {
            clearTimeout(timer)
            timer = undefined
        }
        void runProbe()
    }

    return { watch, stop, probeNow }
}
