// serve(dir, opts) — boot a file-based abide project on a real port (M-CLI / CL2 / BP2-3).
//
// Loads the project at `dir` (loadApp → the createApp config), then boots through the app's
// `onStart(start)` WRAPPER (which binds Bun.serve to `opts.port` or an ephemeral one inside `start()`),
// and returns `{ url, stop }` whose `stop` runs through the `onStop(stop)` wrapper. The content-
// hashed client assets (`/__abide/chunk/*`) and page SSR are already served by the router — `serve`
// only wires the lifecycle and, in dev, the live-reload loop. Production `abide start` passes a
// `clientBuild` (loaded from `dist`) so the router serves the built artifacts with no bundler at boot.
//
// Dev mode (BP2) adds three things over the shared pipeline (no divergent runtime):
//   (a) a reserved dev-reload channel on the socket mux (a `socket()` under `__abide_dev_reload`);
//   (b) a debounced `node:fs` watch of the project `src/` dir that, on change, rebuilds — evicts the
//       client-bundle cache, re-loads the app config in place — then publishes a reload signal;
//   (c) a tiny inline dev client injected into every SSR'd page that subscribes to the mux channel
//       and calls `location.reload()` on that signal.
// Load errors during a rebuild are caught and reported; the server keeps running.

import { type FSWatcher, watch } from 'node:fs'
import { join } from 'node:path'
import { type ClientBuild, invalidateClientBundle } from '../server/internal/clientBundle.ts'
import { type LoadedApp, loadApp } from '../server/internal/loadApp.ts'
import { warmPages } from '../server/internal/pages.ts'
import { type App, createApp } from '../server/internal/router.ts'
import { socket } from '../server/socket.ts'
import { MUX_UPSTREAM } from '../shared/internal/MUX_UPSTREAM.ts'
import { log } from '../shared/log.ts'

// The reserved dev-reload channel name on the socket mux (BP2.3). Not a per-slot cache channel —
// the dev client subscribes to it by name with no join.
const DEV_RELOAD_CHANNEL = '__abide_dev_reload'

// Coalesce a burst of filesystem events into one rebuild.
const WATCH_DEBOUNCE_MS = 60

// Default listen port when none is given (via `--port` or `PORT`). `abide dev` hops upward from here to
// the next free port so parallel dev servers coexist; `abide start` binds it directly.
const DEFAULT_PORT = 3000

// How many ports to probe upward from the requested one (dev only) before giving up and letting the OS
// pick an ephemeral port.
const PORT_SCAN_LIMIT = 100

// The browser-side live-reload client (BP2.3). Connects to the mux, subscribes to the dev-reload
// channel, and reloads on any message. A dev reload is a FULL `location.reload()` (it always reflects
// the edit), but that wipes scroll — so before reloading we snapshot the window scroll plus every
// identified scrolled element (`[data-testid]`/`[id]`, e.g. an `overflow` strip) into sessionStorage,
// and restore it on the next load. Kept dependency-free and defensive so a transport hiccup / a private-
// mode sessionStorage throw never breaks the page.
const DEV_RELOAD_SNIPPET =
    `(function(){try{` +
    `var K="__abide_dev_scroll";` +
    // Restore scroll captured just before the previous dev reload, then clear it (two frames so the
    // SSR'd layout has settled).
    `try{var s=sessionStorage.getItem(K);if(s){sessionStorage.removeItem(K);var st=JSON.parse(s);` +
    `requestAnimationFrame(function(){requestAnimationFrame(function(){` +
    `scrollTo(st.x||0,st.y||0);var es=st.els||[];` +
    `for(var i=0;i<es.length;i++){var n=document.querySelector(es[i].sel);if(n){n.scrollLeft=es[i].l;n.scrollTop=es[i].t;}}` +
    `});});}}catch(_){}` +
    // Snapshot window + every identified scrolled element so the reload can restore position.
    `function cap(){try{var es=[];var ns=document.querySelectorAll("[data-testid],[id]");` +
    `for(var i=0;i<ns.length;i++){var n=ns[i];if(n.scrollLeft||n.scrollTop){var d=n.getAttribute("data-testid");` +
    `var sel=d?'[data-testid="'+d+'"]':'#'+CSS.escape(n.id);es.push({sel:sel,l:n.scrollLeft,t:n.scrollTop});}}` +
    `sessionStorage.setItem(K,JSON.stringify({x:scrollX,y:scrollY,els:es}));}catch(_){}}` +
    `var proto=location.protocol==="https:"?"wss://":"ws://";` +
    `var ws=new WebSocket(proto+location.host+"/__abide/sockets");` +
    // The discriminant is INTERPOLATED from the shared constant, not spelled inline: this string is
    // emitted into the browser, so a rename of `sub` would otherwise leave dev live-reload silently
    // subscribing to nothing, with no compile error anywhere.
    `ws.addEventListener("open",function(){ws.send(JSON.stringify({t:${JSON.stringify(MUX_UPSTREAM.sub)},name:${JSON.stringify(DEV_RELOAD_CHANNEL)}}));});` +
    `ws.addEventListener("message",function(e){try{var f=JSON.parse(e.data);if(f&&f.name===${JSON.stringify(DEV_RELOAD_CHANNEL)}&&f.msg!==undefined){cap();location.reload();}}catch(_){}});` +
    `}catch(_){}})();`

export interface ServeOptions {
    dev?: boolean | undefined
    port?: number | undefined
    // A pre-built client loaded from `dist` (production `abide start`). When set, the router serves it
    // as-is and never runs Bun.build at request time. Absent → the client is built in-memory on first use.
    clientBuild?: ClientBuild | undefined
}

export interface ServeResult {
    url: string
    stop(): Promise<void>
}

// Resolve the listen port from (in order) an explicit `--port`, the `PORT` env var, then DEFAULT_PORT.
// In dev the requested port is only a starting point — if it's taken, hop to the next open one so
// several dev servers can run side by side. Production (`abide start`) binds the requested port as-is,
// so a clash surfaces as a hard EADDRINUSE rather than silently moving.
async function resolvePort(opts: ServeOptions): Promise<number> {
    const requested = opts.port ?? readEnvPort() ?? DEFAULT_PORT
    if (opts.dev === true) return await findOpenPort(requested)
    return requested
}

// Read `PORT` from the environment, ignoring an unset/blank/out-of-range value.
function readEnvPort(): number | undefined {
    const raw = Bun.env.PORT
    if (raw === undefined || raw === '') return undefined
    const port = Number(raw)
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}

// Probe upward from `start` for a port nothing else is bound to, using a throwaway `Bun.serve` bind as
// the availability test. Falls back to the starting port after PORT_SCAN_LIMIT tries (the real bind
// then reports the clash). There's an inherent race between the probe and the real bind, but that's
// acceptable for the dev-only convenience this powers.
async function findOpenPort(start: number): Promise<number> {
    for (let port = start; port < start + PORT_SCAN_LIMIT; port++) {
        try {
            const probe = Bun.serve({ port, fetch: () => new Response() })
            probe.stop(true)
            return port
        } catch (caught) {
            if (isAddressInUse(caught)) continue
            throw caught
        }
    }
    return start
}

// Whether a thrown bind error is "address already in use" (the signal to try the next port).
function isAddressInUse(caught: unknown): boolean {
    if (!(caught instanceof Error)) return false
    const code = (caught as { code?: unknown }).code
    return code === 'EADDRINUSE' || /EADDRINUSE|address already in use/i.test(caught.message)
}

export async function serve(dir: string, opts: ServeOptions = {}): Promise<ServeResult> {
    const config: LoadedApp = await loadApp(dir)
    config.port = await resolvePort(opts)
    // Production (`abide start`) minifies the client bundle; `abide dev` does not (TODO #6).
    config.dev = opts.dev === true
    // Production `abide start` passes the pre-built client loaded from `dist` — the router serves it
    // directly (no Bun.build at request time).
    if (opts.clientBuild !== undefined) config.clientBuild = opts.clientBuild

    // The dev-reload socket must exist in `config.sockets` BEFORE createApp so the router captures it
    // on the mux. Its object identity stays fixed across rebuilds so `publish` keeps reaching clients.
    const reloadSocket = opts.dev === true ? socket<number>() : undefined
    if (reloadSocket !== undefined) {
        config.sockets = { ...(config.sockets ?? {}), [DEV_RELOAD_CHANNEL]: reloadSocket }
        config.devReloadScript = DEV_RELOAD_SNIPPET
    }

    // onStart is a WRAPPER around the real boot (CL2): it receives a `start()` thunk, may run setup
    // BEFORE it, and boots by calling (typically returning) it. The socket binds only inside `start()`
    // (createApp), so no request is accepted until setup completes — closing the old "listening before
    // onStart" race. Pre-compile every page/layout inside the boot too, so the first request to each
    // route hits a warm `SERVER_MODULE_CACHE` instead of racing the on-demand AOT compile. Returning
    // WITHOUT calling `start()` is a deliberate breakout — the app never boots and serve() throws.
    let app: App | undefined
    const start = async (): Promise<void> => {
        if (app !== undefined) return
        app = createApp(config)
        await warmPages(config)
    }
    if (config.onStart !== undefined) await config.onStart(start)
    else await start()
    if (app === undefined) {
        throw new Error('abide: onStart returned without calling start() — the app did not boot.')
    }
    const booted = app

    let watcher: FSWatcher | undefined
    if (reloadSocket !== undefined) {
        watcher = startWatch(dir, config, reloadSocket)
    }

    return {
        url: booted.origin,
        async stop(): Promise<void> {
            watcher?.close()
            // onStop mirrors onStart: a `stop()` thunk it may wrap (e.g. drain in-flight work first).
            // Unlike boot, teardown MUST complete — if the hook returns (or throws) without calling
            // stop(), serve() calls it as a backstop so the server never strands as a zombie. A hook
            // that throws still gets the backstop, then the original error is re-thrown for the caller.
            let stopped = false
            const stop = async (): Promise<void> => {
                if (stopped) return
                stopped = true
                await booted.stop()
            }
            if (config.onStop !== undefined) {
                try {
                    await config.onStop(stop)
                } finally {
                    if (!stopped) await stop()
                }
            } else {
                await stop()
            }
        },
    }
}

// Watch the project `src/` dir; on a debounced change re-load the app config IN PLACE (the router
// reads `config.routes`/`config.pages` live per request, so reassigning those properties is picked
// up without restarting Bun.serve) and signal a reload. `config.sockets` is mutated in place rather
// than reassigned: the router captured that exact object on the mux (router.ts:343), so newly added
// or removed socket files are reconciled into it while the dev-reload channel's identity is kept.
function startWatch(
    dir: string,
    config: LoadedApp,
    reloadSocket: ReturnType<typeof socket<number>>,
): FSWatcher {
    const srcDir = join(dir, 'src')
    let timer: ReturnType<typeof setTimeout> | undefined

    async function rebuild(): Promise<void> {
        try {
            invalidateClientBundle(config)
            const fresh = await loadApp(dir)
            config.routes = fresh.routes ?? {}
            config.pages = fresh.pages ?? {}
            config.pageDirs = fresh.pageDirs ?? {}
            config.layouts = fresh.layouts ?? {}
            config.layoutDirs = fresh.layoutDirs ?? {}
            config.middleware = fresh.middleware ?? []
            syncSockets(config, fresh, reloadSocket)
            await warmPages(config)
            reloadSocket.publish(Date.now())
            log.channel('abide:cli').info('reloaded')
        } catch (caught) {
            log.channel('abide:cli').error(
                'rebuild failed:',
                caught instanceof Error ? caught.message : String(caught),
            )
        }
    }

    return watch(srcDir, { recursive: true }, () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
            timer = undefined
            void rebuild()
        }, WATCH_DEBOUNCE_MS)
    })
}

// Reconcile the live `config.sockets` object with a freshly loaded app so newly added socket files
// appear and deleted ones disappear without a server restart. Mutates in place (the router holds
// this exact object reference) and preserves the reserved dev-reload channel, which is owned by the
// dev loop rather than a project file.
function syncSockets(
    config: LoadedApp,
    fresh: LoadedApp,
    reloadSocket: ReturnType<typeof socket<number>>,
): void {
    let live = config.sockets
    if (live === undefined) {
        live = {}
        config.sockets = live
    }
    for (const name of Object.keys(live)) {
        if (name !== DEV_RELOAD_CHANNEL) delete live[name]
    }
    const next = fresh.sockets ?? {}
    for (const [name, value] of Object.entries(next)) {
        if (name !== DEV_RELOAD_CHANNEL) live[name] = value
    }
    live[DEV_RELOAD_CHANNEL] = reloadSocket
}
