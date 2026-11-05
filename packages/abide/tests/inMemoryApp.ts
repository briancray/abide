// AN APP BOOTED IN THIS PROCESS OVER MODULES THE TEST ALREADY HOLDS — `bootApp` and `appSources`, the
// path `abide start`, a compiled app and `abide dev` all boot through, with no build ahead of it. What
// the build would have supplied is the handler table, and that is derived here off each handler
// file's default through the row `handlersUnder` builds (`handlerFileMount`) — at its file's route
// (16.2, 23.14), with what the handler says of itself at run time and no type-derived `args` schema
// (19.9) unless a row passes one. So a test of what a handler's ANNOTATION does to the
// wire stays on `builtApp.ts`.
//
// No socket is bound — `App.fetch` answers (42.5) — so the DOM preload's `Response` never meets
// `Bun.serve` (see `serve.test.ts`).

import { type App, bootApp } from '#server/createApp.ts'
import { handlerFileMount } from '#server/handlerFileMount.ts'
import { NO_MANIFEST } from '#server/manifestOf.ts'
import type { Mount, MountRow } from '#server/mountHandlers.ts'
import { routeOf } from '#server/placement.ts'
import { appSources } from '#server/servedApp.ts'
import type { Rpc } from '#shared/rpc.ts'

/**
 * An `App` over `modules`, by the path below the app's root of each handler file —
 * `invoices/getInvoice.handler.ts` — to what it exports, its handler as its default (16.73), with `rows`
 * laid over the table derived from them by address.
 */
export function inMemoryApp(
    modules: Record<string, { default: unknown }>,
    rows: Partial<Mount>[] = [],
): Promise<App> {
    const handlers: MountRow[] = []
    for (const [source, exported] of Object.entries(modules)) {
        const address = routeOf(source)
        const handler = exported.default as Rpc<unknown, unknown>
        handlers.push({
            ...handlerFileMount(
                { address, source, scope: address, matchers: {} },
                {
                    method: handler.method,
                    description: handler.description,
                    // Every surface, as a declaration that names none is listed on (20.3, 20.4).
                    ui: true,
                    cli: true,
                    mcp: true,
                    copy: undefined,
                    defaults: undefined,
                    args: undefined,
                    result: undefined,
                },
            ),
            load: async () => exported,
            ...rows.find((row) => row.address === address),
        })
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
                offline: false,
            },
            explained: undefined,
        }),
    )
}
