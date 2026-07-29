// A real browser-side `log`, for `log.test.ts`'s "other side" cases.
//
// This has to be its own PROCESS, not a helper inside the test file. `isBrowser` is a module-load
// constant, and `src/test/happydom.ts` deletes `globalThis.window` precisely so the test process
// reads as a server — so by the time any test runs, every already-imported module has resolved to the
// server branch. Re-importing `log.ts` under a cache-busting query does NOT help: the fresh copy
// still binds `./internal/isBrowser.ts` to the CACHED instance, so it silently takes the server path
// while looking like it took the browser one. (That is not hypothetical — the first version of this
// test did exactly that and passed.)
//
// Here `window` and `localStorage` are installed before the first import of `log`, which is the only
// ordering that makes `isBrowser` true.
//
// Reads `PROBE_DEBUG` as the `localStorage.debug` value; writes the captured console calls to stdout
// as one `@@`-prefixed JSON line.

globalThis.window = { document: {} } as never

Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        getItem: (key: string): string | null =>
            key === 'debug' ? (Bun.env.PROBE_DEBUG ?? null) : null,
    },
})

// A browser has no environment to carry the app name, so the client build bakes it into the loader
// entry as this global (`clientBundle.loaderSource`). Named here so the qualification of a bare
// channel can be asserted on the side that has no `ABIDE_APP_NAME` — which is deleted, since this
// probe does run under Bun and would otherwise read the real one.
delete Bun.env.ABIDE_APP_NAME
;(globalThis as { __ABIDE_APP_NAME__?: string }).__ABIDE_APP_NAME__ = 'probeapp'

const calls: { level: string; args: unknown[] }[] = []
for (const level of ['log', 'info', 'warn', 'error', 'trace'] as const) {
    ;(console as unknown as Record<string, unknown>)[level] = (...args: unknown[]): void => {
        calls.push({ level, args })
    }
}

// Imported AFTER the globals above — the whole point of the file.
const { log } = await import('../log.ts')

// The two channels client-side framework code actually uses: `ui/internal/runtime.ts` warns here when
// hydration finds a mismatch, `ui/internal/streamScheduler.ts` errors here when a stream fails.
log.channel('abide:hydrate').warn('hydration mismatch')
log.channel('abide:stream').error('stream failed')
log.info('the app said something')
// A bare name qualifies under the app on this side too. `error` so the assertion doesn't depend on
// the probe's debug spec, which the gating cases own.
log.channel('cards').error('bare channel')

process.stdout.write(`@@${JSON.stringify(calls)}`)
