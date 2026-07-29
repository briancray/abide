// serveCompiled(app) — boot an abide app INSIDE a `bun build --compile` executable (BP1.6-1.7).
//
// A standalone binary is the same server with a different way of finding itself: `compiledAppConfig`
// assembles the `LoadedApp` from the modules the generated entry statically imported, and from there
// `serve()` resolves the port, runs the `onStart`/`onStop` wrappers, warms the pages and returns the
// same `ServeResult`. A compiled binary enters through `runCompiledApp` and lands here for its `serve`
// subcommand; `commandTarget` is the other door, for the ephemeral server behind a self-hosted call.

import { installShutdownHandlers } from '../../cli/installShutdownHandlers.ts'
import { parsePort } from '../../cli/parsePort.ts'
import { type ServeResult, serve } from '../../cli/serve.ts'
import type { LoadedApp } from '../internal/loadApp.ts'
import type { CompiledApp } from './compiledAppConfig.ts'
import { embeddedClientBuild } from './embeddedClientBuild.ts'

// Takes the ALREADY-BUILT config rather than calling `compiledAppConfig` itself — which is what
// `commandTarget`, the other door, has always done. `compiledAppConfig` is not pure: it assigns
// `ABIDE_APP_NAME` and calls `registerEmittedServer` for every page. `runCompiledApp` builds one to
// derive the command table before it knows the subcommand, so this rebuilding a second one meant
// `./app serve` registered every emitted server module twice and produced two distinct `LoadedApp`
// objects — and `BUNDLE_CACHE` is a WeakMap keyed on the config identity, so they were two cache
// entries for one app. Nothing was visibly broken; it was a trap the module split created.
//
// `argv` is PASSED rather than read off `Bun.argv` here. The dispatcher above it is fully injectable —
// that is what makes the command surface testable in-process — and reading the real process argv from
// inside one branch quietly opted that branch out: `runCompiledApp({ argv: ['serve', '--port', '9'] })`
// resolved the port from whatever the TEST RUNNER was invoked with.
export async function serveCompiled(
    app: CompiledApp,
    config: LoadedApp,
    write: (text: string) => void,
    argv: string[] = Bun.argv.slice(2),
): Promise<ServeResult> {
    // The executable's own command line: `./server --port 8080`, else `PORT`, else 3000 — the same
    // resolution `abide start` performs, including binding the port directly (a clash is a loud
    // EADDRINUSE; production should fail rather than silently move).
    const running = await serve(app.dir, {
        dev: false,
        port: parsePort(argv),
        app: config,
        clientBuild: await embeddedClientBuild(app),
    })
    installShutdownHandlers(running)
    // Through the caller's writer, not `console`: this is the binary's OUTPUT (where your server is),
    // and every other line the compiled CLI emits already goes through the same sink.
    write(`abide — ${running.url}\n`)
    return running
}
