import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appLifecycle } from '../server/internal/appLifecycle.ts'
import { loadApp } from '../server/internal/loadApp.ts'
import { bindRpcChains } from '../server/internal/rpcChain.ts'
import { provideHealthSource } from '../shared/internal/healthSource.ts'

// `abide run <file> [args…]` — run a script UNDER the abide server runtime, serving no HTTP (CL2).
//
// For migrations, cron tasks, one-off maintenance: the things that need the app's config, env
// validation, RPC/socket modules and lifecycle hooks, but have no caller on the other end of a
// socket. `loadApp` is the same discovery `abide start` performs, so `src/server/config.ts` has
// validated at boot and every server API works before the script's first line.
//
// It boots through `appLifecycle`, so `onStart`/`onStop` run with the SAME contract a served app
// gets — wrapper, breakout, backstop — and the only difference is what `start()` does: here it binds
// nothing. That is the whole reason the contract was lifted out of `bootApp`; writing `run` against a
// second copy is how `createTestApp` came to hold a drifted one.
//
// With no request in flight, a server API that reaches for request scope resolves against the
// DEFAULT ambient context (rpc-core §2 — the "no request scope" path), which is what makes an
// ambient-free `memo` usable here and a `crossRequest` one fail closed exactly as it does in a
// handler that escaped its scope.
// `file` is resolved against `dir` and assumed to exist — `main` validates the command line (it owns
// the "no such file" message and its exit code, next to the missing-`<file>` one). A throw from here
// is the SCRIPT's, and propagates with its stack, which for a failed migration is the whole point.
export async function run(dir: string, file: string, args: string[] = []): Promise<void> {
    const target = isAbsolute(file) ? file : resolve(dir, file)
    // 'baked': `abide run` is the PRODUCTION runtime with a script in front of it, not a build. A
    // deployment that ran `abide build` has the derived map on disk and no tsgo, and a migration is not
    // the lane that should pay a derivation pass to discover it — with no bake present this falls back to
    // live derivation anyway, which is what a source checkout gets.
    const config = await loadApp(dir, { schemas: 'baked' })
    // The one boot that binds no server, so `createApp` never runs and never registers what `health()`
    // composes from (CO2.4). A migration asking "is the app healthy" is asking about the app's own
    // `onHealth`, not about an HTTP listener it deliberately does not have — so `run` provides the same
    // source itself, clocked from load rather than from a bind that will not happen.
    const withdrawHealthSource = provideHealthSource({
        startedAt: Date.now(),
        onHealth: config.onHealth,
    })
    // An rpc's OWN middleware runs PER READ, from every door, and a migration is a door. `createApp`
    // installs the chain and `run` deliberately never calls it, so this is the same installer called
    // directly — otherwise "which door built the app" would decide whether a read is authorized, and a
    // script would be the one caller that reads past every guard its rpcs declare.
    //
    // Only the OWN rung: `config.middleware` is per REQUEST and there is no request here (`rpcChain.ts`).
    // That is also what makes this safe to do at all — the global chain is where an app reaches for
    // `request()`, which would throw from this door and fail every read closed.
    bindRpcChains(config)
    const booted = await appLifecycle(config, {
        // Nothing binds. `abide run` is the surface that proves the lifecycle contract is not the
        // HTTP server's — the script IS the workload, and it has not started until it is imported.
        boot: async (): Promise<undefined> => undefined,
        teardown: async (): Promise<void> => {},
    })

    // The script sees the argv `bun <file> [args…]` would have given it, so `process.argv.slice(2)`
    // means the same thing whether it is run through abide or directly. Restored afterwards because a
    // caller (a test, the REPL) may run more than one script in a process.
    const previousArgv = process.argv
    process.argv = [previousArgv[0] ?? 'bun', target, ...args]
    try {
        await import(pathToFileURL(target).href)
    } finally {
        process.argv = previousArgv
        // The script's own throw is what the caller should see, so teardown runs in `finally` and any
        // failure inside `onStop` is left to propagate only when the script itself succeeded.
        withdrawHealthSource()
        await booted.stop()
    }
}
