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

process.stdout.write(`@@${JSON.stringify(calls)}`)
