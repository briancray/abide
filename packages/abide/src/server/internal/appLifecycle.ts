import type { LoadedApp } from './loadApp.ts'

// appLifecycle(config, options) — THE `onStart`/`onStop` wrapper contract (CL3), independent of what
// a given surface means by "started".
//
// The contract has four halves that must not drift:
//   (a) onStart is a WRAPPER — it receives a `start()` thunk, may do setup BEFORE it, and boots by
//       calling it. Nothing the surface provides happens until `start()` runs, so an HTTP surface
//       accepts no connection until setup finishes.
//   (b) Returning from onStart WITHOUT calling `start()` is a deliberate breakout: the app never
//       boots and this throws.
//   (c) Teardown is backstopped — an onStop that forgets `stop()`, or throws before reaching it,
//       still gets the surface torn down (a hook's throw is re-thrown afterwards for the caller).
//   (d) `lifecycle: false` skips the hooks; the backstop still applies.
//
// `boot`/`teardown` are the seam. Two surfaces sit behind it and they are genuinely different, which
// is why this is a seam and not indirection: `bootApp` boots by binding an HTTP server and warming
// every page, and `abide run` boots by binding NOTHING — it runs a script under the loaded runtime
// (CL2) and serves no HTTP at all. Before this split the contract lived inside the HTTP boot, so the
// only way to give `abide run` the same lifecycle was to write a second copy of it — which is exactly
// how `createTestApp` came to hold a drifted third copy.
export interface AppLifecycleOptions<T> {
    // What this surface does to become started. Runs inside the `start()` thunk onStart is handed.
    boot: () => Promise<T>
    // What tearing that down means. Runs at most once, and is backstopped.
    teardown: (booted: T) => Promise<void>
    // Run the app's own hooks (default true).
    lifecycle?: boolean | undefined
}

export interface AppLifecycleResult<T> {
    booted: T
    stop(): Promise<void>
}

export async function appLifecycle<T>(
    config: LoadedApp,
    options: AppLifecycleOptions<T>,
): Promise<AppLifecycleResult<T>> {
    const runHooks = options.lifecycle !== false

    // Tracked by a FLAG, not by whether `booted` holds a value: a surface whose boot legitimately
    // produces nothing (`abide run` binds no server) would otherwise be indistinguishable from an
    // onStart that never called `start()`, and its breakout would report as a successful boot.
    let started = false
    let booted: T | undefined
    const start = async (): Promise<void> => {
        if (started) return
        started = true
        booted = await options.boot()
    }

    if (runHooks && config.onStart !== undefined) await config.onStart(start)
    else await start()
    if (!started) {
        throw new Error('abide: onStart returned without calling start() — the app did not boot.')
    }
    const value = booted as T

    let stopped = false
    const rawStop = async (): Promise<void> => {
        if (stopped) return
        stopped = true
        await options.teardown(value)
    }

    return {
        booted: value,
        async stop(): Promise<void> {
            if (!runHooks || config.onStop === undefined) {
                await rawStop()
                return
            }
            try {
                await config.onStop(rawStop)
            } finally {
                if (!stopped) await rawStop()
            }
        },
    }
}
