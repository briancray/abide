// AN APP BOOTED IN THIS PROCESS OVER MODULES THE TEST ALREADY HOLDS — `bootApp` and `appSources`, the
// path `abide start`, a compiled app and `abide dev` all boot through, with no build ahead of it. What
// the build would have supplied is the handler table, and that is derived here off each export's
// method: the address `handlersUnder` writes, and no type-derived `args` schema (19.9) unless a row
// passes one. So a test of what a handler's ANNOTATION does to the wire stays on `builtApp.ts`.
//
// No socket is bound — `App.fetch` answers (42.5) — so the DOM preload's `Response` never meets
// `Bun.serve` (see `serve.test.ts`).

import { appSources } from '#server/answerRequest.ts'
import type { Mount, MountRow } from '#server/answerRpc.ts'
import { type App, bootApp } from '#server/createApp.ts'
import { NO_MANIFEST } from '#server/manifestOf.ts'
import { routeOf } from '#shared/routePattern.ts'
import type { Method } from '#shared/rpc.ts'

/**
 * An `App` over `modules`, by the path below the app's root of the file declaring them —
 * `invoices/page.abide` — to its server block's exports,
 * with `rows` laid over the table derived from them by address.
 */
export function inMemoryApp(
    modules: Record<string, Record<string, unknown>>,
    rows: Partial<Mount>[] = [],
): Promise<App> {
    const handlers: MountRow[] = []
    for (const [source, exported] of Object.entries(modules)) {
        const route = routeOf(source)
        for (const [name, handler] of Object.entries(exported)) {
            const address = `${route === '/' ? '' : route}/${name}`
            handlers.push({
                load: async () => exported,
                address,
                method: (handler as { method: Method }).method,
                source,
                name,
                ui: true,
                cli: true,
                mcp: true,
                description: undefined,
                copy: undefined,
                defaults: undefined,
                args: undefined,
                ...rows.find((row) => row.address === address),
            })
        }
    }
    return bootApp({ hooks: undefined, package: {} }, () =>
        appSources({
            table: { routes: [], errors: [] },
            handlers,
            published: new Map(),
            client: {
                manifest: NO_MANIFEST,
                head: '',
                framework: () => undefined,
            },
            explained: undefined,
        }),
    )
}
