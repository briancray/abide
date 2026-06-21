// @ts-expect-error virtual module resolved by abideResolverPlugin
import { disconnectedHtml } from './_virtual/bundle-disconnected.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import bundleWindow from './_virtual/bundle-window.ts'
// @ts-expect-error virtual module resolved by abideResolverPlugin
import programName from './_virtual/cli-name.ts'
import type { BundleMenu } from './lib/bundle/BundleMenu.ts'
import type { BundleWindow } from './lib/bundle/BundleWindow.ts'
import { openWebview } from './lib/bundle/openWebview.ts'
import { envSchemaStore } from './lib/server/runtime/envSchemaStore.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { jsonSchemaForSchema } from './lib/shared/jsonSchemaForSchema.ts'

/*
Compiled bundle launcher entry — the executable a bundle runs. Instead of a blank
window it boots into a connect screen, letting the user either connect to a remote
server by URL or start the embedded server binary that ships beside this launcher.

The connect screen is served by a tiny control server, but that server can't live
on this main thread: `openWebview` calls `webview_run`, a native UI loop that
blocks the thread (and its JS event loop) until the window closes, so an
in-process `Bun.serve` would never answer. The control server runs in a Worker
instead (see controlServerWorker.ts) and hands back the origin to point the window
at; it also owns the embedded-server child and the native menu flag, since neither
can be driven from a main thread frozen inside webview_run.

Bun doesn't apply this build's plugins to the worker entry, so the worker can't
import abide's virtual modules; this entry imports them (the connect-screen HTML,
the app title) and passes them in the worker's `init` message.

The window owns the main thread; on close we tell the worker to reap its child.
*/
const window = bundleWindow as BundleWindow
const title = window.title ?? programName

/*
Derive the config form's JSON Schema here (the worker can't import the virtuals
that carry the schema) and pass the plain object through init — the validator
itself isn't serializable, but its JSON Schema is. Undefined when the app
declares no config, so the connect screen never gates Start.

Default source is src/server/config.ts's env schema, so one declaration drives
both boot validation and the setup form. Imported with skipValidation set — we
want the schema's shape, not a boot check the launcher has no business running.
`window.config` replaces it when set, for a bundle form that should differ from
the env schema.
*/
envSchemaStore.skipValidation = true
// @ts-expect-error virtual module resolved by abideResolverPlugin
await import('./_virtual/config.ts')
const formSchema = window.config ?? envSchemaStore.schema
const configSchema = formSchema ? jsonSchemaForSchema(formSchema) : undefined

/*
Spawn the control server worker. `__ABIDE_WORKER_ENTRY__` is the worker's absolute
path, injected by bundleApp via Bun's `define` so the specifier is a static literal
at build time — that's what makes `bun build --compile` embed the worker module
into the standalone binary. A relative specifier resolves against the build's cwd
(the consumer project), not this file, so it isn't found; a
`new URL(..., import.meta.url)` specifier isn't embedded at all.
*/
declare const __ABIDE_WORKER_ENTRY__: string
const worker = new Worker(__ABIDE_WORKER_ENTRY__)

worker.addEventListener('error', (event: ErrorEvent) => {
    abideLog.error(`control server worker failed: ${event.message}`)
})

// Hand the worker the plugin-resolved data it can't import itself, then start it.
worker.postMessage({
    type: 'init',
    init: { disconnectedHtml: disconnectedHtml as string, title, programName, configSchema },
})

/*
The worker, once bound, resolves where the window should open and posts both the
control-server `origin` (for the File-menu action URLs) and the `target` to point
the window at now: the live server when it could resume the last connection, else
the connect screen. Resolving before this means a successful resume opens straight
at the app — no connect-screen flash — at the cost of a brief window-less moment
while it boots/probes (the OS shows the launching dock icon meanwhile).
*/
const { origin, target } = await new Promise<{ origin: string; target: string }>(
    (resolve, reject) => {
        worker.addEventListener('message', (event: MessageEvent) => {
            const data = event.data as {
                type: string
                origin?: string
                target?: string
                error?: string
            }
            if (data.type === 'ready' && data.origin && data.target) {
                resolve({ origin: data.origin, target: data.target })
            } else if (data.type === 'error') {
                /* The worker's start() rejected — fail fast instead of hanging on `ready`. */
                reject(new Error(data.error ?? 'control server worker failed to start'))
            }
        })
    },
)

/*
The built-in File menu (Start / Disconnect), placed before Edit. Each item is a
`navigate` repointing the window at a control-server URL the connect screen
interprets; the internal `role` drives the native validateMenuItem: gating (Start
when disconnected, Disconnect when connected). There's no Connect item — Disconnect
already returns to the connect screen, whose form is the place to point at another
server. Roled items are launcher-only, so they carry an extra field the public
BundleMenuItem type doesn't advertise — modelled here with a local type and bridged
to BundleMenu when handed to openWebview (which only serialises the menu to JSON).
*/
type FileMenuItem =
    | { separator: true }
    | {
          label: string
          shortcut?: string
          navigate: string
          role: 'start' | 'disconnect'
      }
const fileMenu: { label: string; items: FileMenuItem[] } = {
    label: 'File',
    items: [
        { label: 'Start Server', navigate: `${origin}/?action=start`, role: 'start' },
        { separator: true },
        { label: 'Disconnect', navigate: `${origin}/?action=disconnect`, role: 'disconnect' },
    ],
}

abideLog.info(`opening ${title} window at ${target}`)
await openWebview({
    url: target,
    title,
    width: window.width,
    height: window.height,
    menu: window.menu,
    fileMenu: fileMenu as unknown as BundleMenu,
    // Forward the window handle so the worker can bounce it back to the connect
    // screen if the connected server stops responding.
    onWindow: (handle) => {
        if (handle) {
            worker.postMessage({ type: 'window', handle: Number(handle) })
        }
    },
})

/*
Window closed — have the worker reap the embedded server child and stop its
control server before we exit, since both live on the worker thread. Bounded by a
timeout so a wedged worker can't keep the launcher alive.
*/
await new Promise<void>((resolve) => {
    worker.addEventListener('message', (event: MessageEvent) => {
        if ((event.data as { type?: string }).type === 'shutdownDone') {
            resolve()
        }
    })
    worker.postMessage({ type: 'shutdown' })
    setTimeout(resolve, 1000)
})
worker.terminate()
process.exit(0)
