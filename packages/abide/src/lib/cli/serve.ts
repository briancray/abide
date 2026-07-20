// serve(dir, opts) — boot a file-based abide project on a real port (M-CLI / CL2 / BP2-3).
//
// Loads the project at `dir` (loadApp → the createApp config), binds Bun.serve to `opts.port` or an
// ephemeral one, runs the app's `onStart` lifecycle hook, and returns `{ url, stop }`. The client
// bundle at `/__abide/client.js` and page SSR are already served by the router — `serve` only wires
// the lifecycle and, in dev, the live-reload loop.
//
// Dev mode (BP2) adds three things over the shared pipeline (no divergent runtime):
//   (a) a reserved dev-reload channel on the socket mux (a `socket()` under `__abide_dev_reload`);
//   (b) a debounced `node:fs` watch of the project `src/` dir that, on change, rebuilds — evicts the
//       client-bundle cache, re-loads the app config in place — then publishes a reload signal;
//   (c) a tiny inline dev client injected into every SSR'd page that subscribes to the mux channel
//       and calls `location.reload()` on that signal.
// Load errors during a rebuild are caught and reported; the server keeps running.

import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { loadApp, type LoadedApp } from "../server/internal/loadApp.ts";
import { createApp } from "../server/internal/router.ts";
import { invalidateClientBundle } from "../server/internal/clientBundle.ts";
import { warmPages } from "../server/internal/pages.ts";
import { socket } from "../server/socket.ts";

// The reserved dev-reload channel name on the socket mux (BP2.3). Not a per-slot cache channel —
// the dev client subscribes to it by name with no join.
const DEV_RELOAD_CHANNEL = "__abide_dev_reload";

// Coalesce a burst of filesystem events into one rebuild.
const WATCH_DEBOUNCE_MS = 60;

// The browser-side live-reload client (BP2.3). Connects to the mux, subscribes to the dev-reload
// channel, and reloads on any message. Kept dependency-free and defensive so a transport hiccup
// never breaks the page.
const DEV_RELOAD_SNIPPET =
  `(function(){try{` +
  `var proto=location.protocol==="https:"?"wss://":"ws://";` +
  `var ws=new WebSocket(proto+location.host+"/__abide/sockets");` +
  `ws.addEventListener("open",function(){ws.send(JSON.stringify({t:"sub",name:${JSON.stringify(DEV_RELOAD_CHANNEL)}}));});` +
  `ws.addEventListener("message",function(e){try{var f=JSON.parse(e.data);if(f&&f.name===${JSON.stringify(DEV_RELOAD_CHANNEL)})location.reload();}catch(_){}});` +
  `}catch(_){}})();`;

export interface ServeOptions {
  dev?: boolean | undefined;
  port?: number | undefined;
}

export interface ServeResult {
  url: string;
  stop(): Promise<void>;
}

export async function serve(dir: string, opts: ServeOptions = {}): Promise<ServeResult> {
  const config: LoadedApp = await loadApp(dir);
  if (opts.port !== undefined) config.port = opts.port;
  // Production (`abide start`) minifies the client bundle; `abide dev` does not (TODO #6).
  config.dev = opts.dev === true;

  // The dev-reload socket must exist in `config.sockets` BEFORE createApp so the router captures it
  // on the mux. Its object identity stays fixed across rebuilds so `publish` keeps reaching clients.
  const reloadSocket = opts.dev === true ? socket<number>() : undefined;
  if (reloadSocket !== undefined) {
    config.sockets = { ...(config.sockets ?? {}), [DEV_RELOAD_CHANNEL]: reloadSocket };
    config.devReloadScript = DEV_RELOAD_SNIPPET;
  }

  const app = createApp(config);
  if (config.onStart !== undefined) await config.onStart();

  // Pre-compile every page/layout before accepting traffic so the first request to each route hits a
  // warm `SERVER_MODULE_CACHE` instead of racing the on-demand AOT compile (removes first-hit latency
  // and the e2e `fullyParallel` compile race). Compile-only, so no request scope is needed.
  await warmPages(config);

  let watcher: FSWatcher | undefined;
  if (reloadSocket !== undefined) {
    watcher = startWatch(dir, config, reloadSocket);
  }

  return {
    url: app.origin,
    async stop(): Promise<void> {
      watcher?.close();
      if (config.onStop !== undefined) await config.onStop();
      await app.stop();
    },
  };
}

// Watch the project `src/` dir; on a debounced change re-load the app config IN PLACE (the router
// reads `config.routes`/`config.pages` live per request, so reassigning those properties is picked
// up without restarting Bun.serve) and signal a reload. `config.sockets` is mutated in place rather
// than reassigned: the router captured that exact object on the mux (router.ts:343), so newly added
// or removed socket files are reconciled into it while the dev-reload channel's identity is kept.
function startWatch(dir: string, config: LoadedApp, reloadSocket: ReturnType<typeof socket<number>>): FSWatcher {
  const srcDir = join(dir, "src");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function rebuild(): Promise<void> {
    try {
      invalidateClientBundle(config);
      const fresh = await loadApp(dir);
      config.routes = fresh.routes ?? {};
      config.pages = fresh.pages ?? {};
      config.pageDirs = fresh.pageDirs ?? {};
      config.layouts = fresh.layouts ?? {};
      config.layoutDirs = fresh.layoutDirs ?? {};
      config.middleware = fresh.middleware ?? [];
      syncSockets(config, fresh, reloadSocket);
      await warmPages(config);
      reloadSocket.publish(Date.now());
      console.info("[abide:dev] reloaded");
    } catch (caught) {
      console.error("[abide:dev] rebuild failed:", caught instanceof Error ? caught.message : String(caught));
    }
  }

  return watch(srcDir, { recursive: true }, () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void rebuild();
    }, WATCH_DEBOUNCE_MS);
  });
}

// Reconcile the live `config.sockets` object with a freshly loaded app so newly added socket files
// appear and deleted ones disappear without a server restart. Mutates in place (the router holds
// this exact object reference) and preserves the reserved dev-reload channel, which is owned by the
// dev loop rather than a project file.
function syncSockets(config: LoadedApp, fresh: LoadedApp, reloadSocket: ReturnType<typeof socket<number>>): void {
  const live = config.sockets ?? (config.sockets = {});
  for (const name of Object.keys(live)) {
    if (name !== DEV_RELOAD_CHANNEL) delete live[name];
  }
  const next = fresh.sockets ?? {};
  for (const name of Object.keys(next)) {
    if (name !== DEV_RELOAD_CHANNEL) live[name] = next[name]!;
  }
  live[DEV_RELOAD_CHANNEL] = reloadSocket;
}
