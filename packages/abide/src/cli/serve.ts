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
import type { ClientBuild } from '../server/internal/clientBundle.ts'
import { DEFAULT_PORT, hostApp, readEnvPort, type ServeResult } from '../server/internal/hostApp.ts'
import { type LoadedApp, loadApp } from '../server/internal/loadApp.ts'
import { warmPages } from '../server/internal/pages.ts'
import type { App } from '../server/internal/router.ts'
import { socket } from '../server/socket.ts'
import { MUX_UPSTREAM } from '../shared/internal/MUX_UPSTREAM.ts'
import { SOCKETS_ROUTE } from '../shared/internal/SOCKETS_ROUTE.ts'
import { log } from '../shared/log.ts'
import { writeHealthCompanion } from './writeHealthCompanion.ts'

// The reserved dev-reload channel name on the socket mux (BP2.3). Not a per-slot cache channel —
// the dev client subscribes to it by name with no join.
const DEV_RELOAD_CHANNEL = '__abide_dev_reload'

// Coalesce a burst of filesystem events into one rebuild.
const WATCH_DEBOUNCE_MS = 60

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
    // The ADDRESS is interpolated for the same reason the discriminant below is: this string is
    // emitted into the browser, so a rename would leave dev live-reload dialling a 404 in silence.
    `var ws=new WebSocket(proto+location.host+${JSON.stringify(SOCKETS_ROUTE)});` +
    // The discriminant is INTERPOLATED from the shared constant, not spelled inline: this string is
    // emitted into the browser, so a rename of `sub` would otherwise leave dev live-reload silently
    // subscribing to nothing, with no compile error anywhere.
    `ws.addEventListener("open",function(){ws.send(JSON.stringify({t:${JSON.stringify(MUX_UPSTREAM.sub)},name:${JSON.stringify(DEV_RELOAD_CHANNEL)}}));});` +
    `ws.addEventListener("message",function(e){try{var f=JSON.parse(e.data);if(f&&f.name===${JSON.stringify(DEV_RELOAD_CHANNEL)}&&f.msg!==undefined){cap();location.reload();}}catch(_){}});` +
    `}catch(_){}})();`

// Re-exported so the CLI keeps naming its result from the module it calls; the shape belongs to
// `hostApp`, which is what actually produces it.
export type { ServeResult }

export interface ServeOptions {
    dev?: boolean | undefined
    port?: number | undefined
    // A pre-built client loaded from `dist` (production `abide start`). When set, the router serves it
    // as-is and never runs Bun.build at request time. Absent → the client is built in-memory on first use.
    clientBuild?: ClientBuild | undefined
    // An app config assembled WITHOUT scanning the filesystem — what a `abide compile` binary boots
    // from, where the project's modules are static imports baked into the executable and `dir` names a
    // source tree that isn't on the machine. Everything after loading (port resolution, the onStart /
    // onStop wrappers, warm pages, stop) is identical, which is the point: one boot path, two ways of
    // getting the config.
    app?: LoadedApp | undefined
}

// Resolve the listen port from (in order) an explicit `--port`, the `PORT` env var, then DEFAULT_PORT.
// In dev the requested port is only a starting point — if it's taken, hop to the next open one so
// several dev servers can run side by side. Production (`abide start`) binds the requested port as-is,
// so a clash surfaces as a hard EADDRINUSE rather than silently moving.
// Both numbers are returned, not just the one bound: the banner reports the hop, and the requested
// port is only knowable here — reading the same ladder a second time in the CLI would be a copy that
// nothing keeps in step.
async function resolvePort(opts: ServeOptions): Promise<{ requested: number; bound: number }> {
    const requested = opts.port ?? readEnvPort() ?? DEFAULT_PORT
    if (opts.dev !== true) return { requested, bound: requested }
    const bound = await findOpenPort(requested)
    if (bound !== requested) realignAppUrlToBoundPort(requested, bound)
    return { requested, bound }
}

// A dev port hop moves the app; `APP_URL` still names where it WAS. Carry it to where the app actually
// listens, because APP_URL is not merely the mount base — it is the expected origin BOTH origin gates
// compare against (`socketOriginAllowed`, AU8's `csrfReject`), and those are the only two readers that
// matter here. Left stale, the server rejects its OWN browser: every WS upgrade is a 403 (CSWSH) and the
// client mux reconnect-loops on it, and — silently, which is the worse half — every MUTATION is a 403
// (CSRF) while reads sail through, because reads are exempt from that gate. So the page loads, looks
// healthy, and is read-only. The banner's dim `port 3000 was taken` note is the only trace, and nothing
// connects it to either symptom.
//
// This is a REALIGNMENT, not a relaxation: the gates still compare a full origin and still reject a
// genuinely foreign one. Only dev hops (`abide start` binds directly and fails hard on EADDRINUSE, so
// its APP_URL cannot drift out from under it).
//
// Rewritten ONLY when APP_URL's port is the one we asked for — that is what identifies it as describing
// THIS server rather than something in front of it. An APP_URL naming a different port or none at all
// (a tunnel, a reverse proxy, `https://app.example`) is a deliberate statement about a front door the
// hop did not move, and overwriting it would break the gate it exists to feed.
function realignAppUrlToBoundPort(requested: number, bound: number): void {
    const appUrl = Bun.env.APP_URL
    if (appUrl === undefined || appUrl.length === 0) return
    let parsed: URL
    try {
        parsed = new URL(appUrl)
    } catch {
        return
    }
    if (parsed.port !== String(requested)) return
    parsed.port = String(bound)
    Bun.env.APP_URL = parsed.origin
    log.channel('abide:cli').warn(
        `port ${requested} was taken; APP_URL realigned to ${parsed.origin} so the origin gates match where the app bound`,
    )
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
    // Only `abide dev` writes into `src/`: it is the lane an editor is pointed at. `abide start` serves
    // the same code in production and has no business regenerating source-adjacent types at boot.
    if (opts.dev === true) await writeHealthCompanion(dir)
    // `abide dev` derives schemas from SOURCE; `abide start` reads the bake `abide build` left. The lane
    // says which, rather than `loadApp` guessing from whether `dist/schemas.json` is on disk — see
    // `LoadAppOptions.schemas` for what that guess cost.
    const config: LoadedApp =
        opts.app ?? (await loadApp(dir, { schemas: opts.dev === true ? 'source' : 'baked' }))

    // The dev-reload socket must exist in `config.sockets` BEFORE createApp so the router captures it
    // on the mux. Its object identity stays fixed across rebuilds so `publish` keeps reaching clients.
    const reloadSocket = opts.dev === true ? socket<number>() : undefined
    if (reloadSocket !== undefined) {
        config.sockets = { ...(config.sockets ?? {}), [DEV_RELOAD_CHANNEL]: reloadSocket }
        config.devReloadScript = DEV_RELOAD_SNIPPET
    }

    // Everything from here that is not dev-specific is `hostApp`, which a compiled binary enters
    // directly — see its header for why that floor is worth having.
    const port = await resolvePort(opts)
    const hosted = await hostApp(config, {
        port: port.bound,
        dev: opts.dev === true,
        ...(opts.clientBuild !== undefined ? { clientBuild: opts.clientBuild } : {}),
    })

    if (reloadSocket === undefined) return { ...hosted, requestedPort: port.requested }

    const watcher = startWatch(dir, config, reloadSocket, hosted.app)
    return {
        url: hosted.url,
        requestedPort: port.requested,
        async stop(): Promise<void> {
            watcher.close()
            await hosted.stop()
        },
    }
}

// Watch the project `src/` dir; on a debounced change re-load the app config IN PLACE (the router
// reads `config.routes`/`config.pages` live per request, so reassigning those properties is picked
// up without restarting Bun.serve) and signal a reload. `config.sockets` is mutated in place rather
// than reassigned, so newly added or removed socket files are reconciled into it while the dev-reload
// channel's identity is kept.
//
// READING LIVE IS ONLY HALF OF IT, and the missing half was silent. Much of what the router serves is
// DERIVED from the registry at boot, and a reassigned `config.routes` invalidates every one of those
// while looking like a live read. So a rebuild must also tell the app to re-derive (`app.rebind()`).
// Without it, the first file save silently dropped per-rpc `middleware` and `crossOrigin` for the rest of
// the session: authorization derived from a build that was no longer running.
//
// WHICH derivations those are is deliberately not enumerated here any more, and this loop no longer
// invalidates any of them by hand. `registryDerivation.ts` owns the set; `rebind()` runs it. The previous
// spelling — a list in this comment plus a hand-called `invalidateClientBundle` one line up — is exactly
// how two further derivations (the page-pattern list, the agent tool surface) came to exist with no
// invalidation at all: nothing required a new cache to appear in either place.
function startWatch(
    dir: string,
    config: LoadedApp,
    reloadSocket: ReturnType<typeof socket<number>>,
    app: App,
): FSWatcher {
    const srcDir = join(dir, 'src')
    let timer: ReturnType<typeof setTimeout> | undefined

    async function rebuild(): Promise<void> {
        try {
            // From SOURCE: this is the rebuild, so a bake from an earlier `abide build` is by
            // definition the thing being replaced.
            const fresh = await loadApp(dir, { schemas: 'source' })
            // Regenerated before anything else: an edit to `onHealth` changes the app's health TYPE,
            // and an editor that reads the stale companion would report the old shape against the new
            // hook. The router reads `config.onHealth` live (a getter), so the two land together.
            await writeHealthCompanion(dir)
            config.onHealth = fresh.onHealth
            config.routes = fresh.routes ?? {}
            config.pages = fresh.pages ?? {}
            config.pageDirs = fresh.pageDirs ?? {}
            config.layouts = fresh.layouts ?? {}
            config.layoutDirs = fresh.layoutDirs ?? {}
            config.middleware = fresh.middleware ?? []
            syncSockets(config, fresh, reloadSocket)
            // AFTER every property is in place and BEFORE the reload signal: re-derive everything the
            // router computed from the old registry, so the next request is served by this build's
            // authorization rather than the boot's.
            app.rebind()
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
