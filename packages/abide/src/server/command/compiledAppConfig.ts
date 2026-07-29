// compiledAppConfig(app) — assemble a `LoadedApp` from the modules a `bun build --compile` binary
// statically imported (BP1.6-1.7).
//
// `loadApp` discovers a project by scanning + dynamically importing it; a binary has no project on the
// machine, so `abide compile` writes a generated entry that STATICALLY imports every
// module and hands the namespaces here. From this point the two paths converge: the module objects are
// read by the SAME rules (`singleExport`/`isRoute`/`isSocket`/`appModuleExports`, so "what is the RPC in
// this file" has one definition), and the resulting config is the one `serve()` boots.
//
// Also registers the AOT-emitted server module for every page/layout — a binary cannot compile `.abide`
// at runtime (nowhere to write, no source to read), so the compile step emitted them beside the entry.
//
// Kept separate from `serveCompiled` because BOOTING is only one of the things a binary does with its
// embedded app: the same config projects the `clients.cli` RPCs into subcommands, and in remote mode
// (`--url`) it never boots at all.

import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { registerEmittedServer } from '../../ui/internal/emit.ts'
import {
    appModuleExports,
    isRoute,
    isSocket,
    type LoadedApp,
    singleExport,
} from '../internal/loadApp.ts'
import { mergeSchemas } from '../internal/mergeSchemas.ts'
import type { Route } from '../internal/router.ts'
import type { Socket } from '../socket.ts'

// One embedded client asset: the chunk's served NAME plus the in-binary path of each encoding the
// build kept for it. A dropped encoding is simply absent.
export interface CompiledAsset {
    name: string
    identity: string
    gzip?: string
    brotli?: string
}

// A statically imported project module, under the name its file gave it.
export interface CompiledModule {
    name: string
    module: Record<string, unknown>
}

// One page/layout: its source (the cache key SSR looks it up by), the dir it was compiled from, and
// the AOT-emitted `render` for it.
export interface CompiledPage {
    source: string
    dir: string
    render(scope?: Record<string, unknown>): Promise<string>
}

// Everything the generated entry statically imported, in the shape the server wants it. Deliberately
// flat and literal: this interface IS the contract the code generator writes against.
export interface CompiledApp {
    // The source dir the binary was compiled FROM. Never read as a filesystem path at runtime — it is
    // the key half of the emitted-module registry and the page/layout dir maps, which only have to
    // agree with what the compile step registered.
    dir: string
    // The project's package.json `name`, baked at compile time — it is the default `log(...)` channel
    // label (CO2.2) and the CLI binary's own program name, neither of which a binary can read off a
    // package.json that isn't there.
    name: string
    rpc: CompiledModule[]
    sockets: CompiledModule[]
    // `src/app.ts`, when the project has one.
    app?: Record<string, unknown>
    // Page/layout sources keyed as the router keys them (route path / layout prefix).
    pages: Record<string, string>
    pageDirs: Record<string, string>
    layouts: Record<string, string>
    layoutDirs: Record<string, string>
    modules: CompiledPage[]
    schemas: Record<string, { input?: JSONSchema; output?: JSONSchema }>
    client: { entry: string; css: string | null; chunkByPattern: Record<string, string> }
    assets: CompiledAsset[]
    // Request path → in-binary path, for `src/ui/public/**`.
    publicFiles: Record<string, string>
}

export function compiledAppConfig(app: CompiledApp): LoadedApp {
    // Same precedence as the filesystem boot: an explicit operator override wins over the app name.
    if (process.env.ABIDE_APP_NAME === undefined || process.env.ABIDE_APP_NAME.length === 0) {
        process.env.ABIDE_APP_NAME = app.name
    }
    for (const page of app.modules) {
        registerEmittedServer(page.source, page.dir, { render: page.render })
    }

    const routes: Record<string, Route> = {}
    for (const { name, module } of app.rpc) {
        const exported = singleExport(module)
        if (exported !== undefined && isRoute(exported.value)) routes[name] = exported.value
    }
    mergeSchemas(routes, app.schemas)

    const sockets: Record<string, Socket<unknown>> = {}
    for (const { name, module } of app.sockets) {
        const exported = singleExport(module)
        if (exported !== undefined && isSocket(exported.value)) sockets[name] = exported.value
    }

    const appModule = app.app === undefined ? undefined : appModuleExports(app.app)
    const config: LoadedApp = {
        dir: app.dir,
        routes,
        sockets,
        pages: app.pages,
        pageDirs: app.pageDirs,
        layouts: app.layouts,
        layoutDirs: app.layoutDirs,
        middleware: appModule?.middleware ?? [],
        publicFiles: app.publicFiles,
    }
    if (appModule?.lifecycle.onStart !== undefined) config.onStart = appModule.lifecycle.onStart
    if (appModule?.lifecycle.onStop !== undefined) config.onStop = appModule.lifecycle.onStop
    if (appModule?.onHealth !== undefined) config.onHealth = appModule.onHealth
    if (appModule?.onError !== undefined) config.onError = appModule.onError
    return config
}
