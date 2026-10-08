// AN APP BOOTED IN THIS PROCESS OVER MODULES THE TEST ALREADY HOLDS — `bootApp` and `appSources`, the
// path `abide start`, a compiled app and `abide dev` all boot through, with no build ahead of it. What
// the build would have supplied is the handler table, and that is derived here off each export's
// method: the address `handlersUnder` writes, and no type-derived `args` schema (19.10) unless a row
// passes one. So a test of what a handler's ANNOTATION does to the wire stays on `builtApp.ts`.
//
// No socket is bound — `App.fetch` answers (42.5) — so the DOM preload's `Response` never meets
// `Bun.serve` (see `serve.test.ts`).

import { appSources } from '#server/answerRequest.ts'
import type { Mount } from '#server/answerRpc.ts'
import { type App, bootApp } from '#server/createApp.ts'
import { NO_MANIFEST } from '#server/manifestOf.ts'
import { RPC_ADDRESS } from '#shared/ADDRESSES.ts'
import type { Method } from '#shared/rpc.ts'

/**
 * An `App` over `modules`, by source path below the app's root — `server/rpc/invoices.ts` — to the
 * module's exports, with `rows` laid over the table derived from them by address.
 */
export function inMemoryApp(
    modules: Record<string, Record<string, unknown>>,
    rows: Partial<Mount>[] = [],
): Promise<App> {
    const handlers: Mount[] = []
    for (const [source, exported] of Object.entries(modules)) {
        const path = source.replace(/^server\/rpc\//, '').replace(/\.ts$/, '')
        for (const [name, handler] of Object.entries(exported)) {
            const address = `${RPC_ADDRESS}/${path}${name === 'default' ? '' : `/${name}`}`
            handlers.push({
                address,
                method: (handler as { method: Method }).method,
                source,
                name,
                ui: true,
                cli: true,
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
            shell: '<!doctype html><html><head></head><body></body></html>',
            handlers,
            handlerModule: async (source) => modules[source] ?? {},
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
