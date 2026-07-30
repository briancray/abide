// hostApp(config, options) — bring a LOADED app up on a port and hand back its lifecycle. The half of
// serving that every surface shares, with nothing in it that reads the project's source.
//
// It exists to give the compiled binary a dependency FLOOR. `serveCompiled` used to enter through
// `cli/serve.ts`, which is one function with five dev-time branches — so the binary's module graph
// could not follow the interface `ServeOptions` already describes (`app` set = no discovery,
// `clientBuild` set = no bundler, `dev` = watch + companion + reload snippet; a binary always passes the
// first two and never the third). Measured on the compiled entry, that dragged in `loadApp` and with it
// `scanAppSources` + `deriveSchemas`, plus `writeHealthCompanion`, `startWatch` and the dev-reload
// browser snippet.
//
// SIZE IS THE LESSER PROBLEM. Those are reachable code that CANNOT WORK where a binary runs: the
// filesystem is a read-only `/$bunfs/root`, there is no `src/` to watch or write a companion into, and
// no source to derive a schema from. Nothing prevented a future edit from calling one, and the failure
// would land on a deploy machine rather than in a test.
//
// What this deliberately does NOT remove is `Bun.build`. That reaches the binary through the ROUTER —
// `chunkAsset.ts` and `navRoute.ts` both import `clientBuildFor` — because an app served without a
// prebuilt client still has to produce one. Moving the boot path could never have removed it, and a
// floor test that claimed otherwise would be asserting a fiction. `compiledAppFloor.test.ts` names it as
// a known resident for exactly that reason.

import { bootApp } from './bootApp.ts'
import type { ClientBuild } from './clientBundle.ts'
import type { LoadedApp } from './loadApp.ts'
import type { App } from './router.ts'

// The default listen port when none is given. Shared with the dev lane, which hops upward from it.
export const DEFAULT_PORT = 3000

export interface HostAppOptions {
    // The resolved port. Already resolved, because HOW it is resolved is the lane's business: `abide dev`
    // hops to the next open one so several dev servers coexist, `abide start` and a binary bind it
    // directly so a clash is a loud EADDRINUSE rather than a silent move.
    port: number
    // Dev serves an unminified client bundle (TODO #6). Nothing else about dev lives here.
    dev?: boolean | undefined
    // A pre-built client — loaded from `dist` by `abide start`, embedded by a compiled binary. When set
    // the router serves it as-is and never runs Bun.build at request time.
    clientBuild?: ClientBuild | undefined
}

export interface ServeResult {
    url: string
    stop(): Promise<void>
}

// A superset of `ServeResult`: the running `App` as well, which the dev watcher needs so a rebuild can
// call `rebind()`. Not on `ServeResult` itself — that is what `serve` hands a CLI command, and a command
// has no business reaching the router.
export interface HostedApp extends ServeResult {
    app: App
}

// Read `PORT` from the environment, ignoring an unset/blank/out-of-range value. Here rather than in the
// dev lane because `abide start` and a compiled binary honour it too.
export function readEnvPort(): number | undefined {
    const raw = Bun.env.PORT
    if (raw === undefined || raw === '') return undefined
    const port = Number(raw)
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}

export async function hostApp(config: LoadedApp, options: HostAppOptions): Promise<HostedApp> {
    config.port = options.port
    config.dev = options.dev === true
    if (options.clientBuild !== undefined) config.clientBuild = options.clientBuild

    // The onStart/onStop wrapper lifecycle — including the page warm and the teardown backstop — is
    // `bootApp`, shared with `createTestApp` so a test boots the app the same way production does.
    const booted = await bootApp(config)
    return {
        url: booted.app.origin,
        stop: booted.stop,
        app: booted.app,
    }
}
