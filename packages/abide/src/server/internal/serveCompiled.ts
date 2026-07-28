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
import { type CompiledApp, compiledAppConfig } from './compiledAppConfig.ts'
import { embeddedClientBuild } from './embeddedClientBuild.ts'

export async function serveCompiled(app: CompiledApp): Promise<ServeResult> {
    const config = compiledAppConfig(app)

    // The executable's own command line: `./server --port 8080`, else `PORT`, else 3000 — the same
    // resolution `abide start` performs, including binding the port directly (a clash is a loud
    // EADDRINUSE; production should fail rather than silently move).
    const running = await serve(app.dir, {
        dev: false,
        port: parsePort(Bun.argv.slice(2)),
        app: config,
        clientBuild: await embeddedClientBuild(app),
    })
    installShutdownHandlers(running)
    console.info(`abide — ${running.url}`)
    return running
}
