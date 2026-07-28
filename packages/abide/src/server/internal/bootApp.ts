// bootApp(config, options) — bring an abide app up as an HTTP SERVER. Every serving surface runs
// through here: `abide dev`, `abide start`, `abide scaffold`'s dev server, a compiled binary's
// `serve`, the ephemeral server behind a self-hosted CLI call (all five via `serve()`), and
// `createTestApp` in discovery mode.
//
// The `onStart`/`onStop` wrapper contract itself lives in `appLifecycle` — it is shared with `abide
// run`, which takes the same contract and binds no server at all. What is HTTP-specific is only what
// "booted" means here, and that is the two lines in `boot` below:
//
//   • the socket binds inside `start()` (createApp), so nothing is accepted until setup finishes;
//   • `start()` also warms every page/layout, so the first request to a route hits a warm
//     SERVER_MODULE_CACHE instead of racing the on-demand AOT compile. This is part of the boot
//     CONTRACT, not of serve(): a test that exercises the cold compile path is testing something
//     production never does, which is exactly the drift `createTestApp` had.

import { appLifecycle } from './appLifecycle.ts'
import type { LoadedApp } from './loadApp.ts'
import { warmPages } from './pages.ts'
import { type App, createApp } from './router.ts'

export interface BootAppOptions {
    // Run the app's own `onStart`/`onStop` hooks (default true). `createTestApp({ lifecycle: false })`
    // sets it false to skip a boot a given test does not exercise; the warm + backstop still apply.
    lifecycle?: boolean | undefined
}

export interface BootedApp {
    app: App
    stop(): Promise<void>
}

export async function bootApp(config: LoadedApp, options: BootAppOptions = {}): Promise<BootedApp> {
    const running = await appLifecycle(config, {
        lifecycle: options.lifecycle,
        boot: async (): Promise<App> => {
            const app = createApp(config)
            await warmPages(config)
            return app
        },
        teardown: (app) => app.stop(),
    })
    return { app: running.booted, stop: running.stop }
}
