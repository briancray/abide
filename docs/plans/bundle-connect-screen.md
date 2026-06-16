# Plan: bundle connect screen + Start/Connect/Disconnect

## Goal

A `abide bundle` desktop app should boot into a **connect screen** instead of a blank
window, let the user either **connect to a remote server by URL** or **start the embedded
server**, and expose **Start server / Connect / Disconnect** in a native menu whose items
enable/disable based on connection state. The chosen remote URL persists across launches
via `localStorage`.

This is **one full bundle** (launcher + compiled server binary + webview lib) — we keep
`compile()` in the bundle pipeline. The remote-vs-local choice moves from a *build mode*
into the *connect screen at runtime*.

## Project conventions (READ FIRST — these are hard rules)

From `CLAUDE.md`:

- **Bun + native JS APIs only** (`Bun.serve`, `Bun.file`, `Bun.build`, `bun:ffi`). No node:* unless already used nearby (`node:path` / `node:fs` `existsSync`/`statSync` are acceptable — the codebase already uses them).
- **No barrels.** Every public name has its own module path/file. One export per file, named after the file.
- **Pure functions, functional style**, `map`/`filter`/`reduce` over loops where applicable.
- **`undefined`, not `null`**, unless a type needs null.
- **Svelte 5** components (runes: `$props`, `$state`, `$derived`, `$effect`).
- **Tailwind classes** for styling, prefer over inline styles.
- **Always use braces** on `if` statements, no single-line ifs.
- **Short descriptive comments** above each function and any non-obvious block; `/* */` for multiline, `//` for single line. Match the dense, explanatory comment style already in `src/lib/bundle/`.
- **Descriptive names**, no abbreviations.
- **Do NOT touch README or examples** unless explicitly told. (This plan does NOT update them. Leave `examples/kitchen-sink/src/bundle/` and the README alone.)
- **Run `bun format`** on every changed/created file when done (the repo uses biome — `bun format` or `bunx biome format --write <files>`).
- Reactive consumers use `createSubscriber` from `svelte/reactivity` — not relevant here, but don't invent parallel reactivity.

`lib/` layout: `lib/server/` (server-only), `lib/browser/` (html consumer), `lib/shared/`
(cross-side). Bundle desktop machinery lives in `lib/bundle/`. New bundle files go in
`lib/bundle/`.

## Key facts about the current code (verified — don't re-derive, but DO re-read before editing)

- `packages/abide/bin/abide.ts` — CLI dispatcher. `bundle` command → `bundleCmd()` → `bundleApp({ cwd })`. Has a `usage()` string. `parseFlag(name)` helper for `--name=value`/`--name value`.
- `packages/abide/src/bundleApp.ts` — builds the `.app` (macOS) or flat dir. Steps: (1) `compile()` server binary → `binDir/server`, (2) build launcher from `appEntry.ts` → `binDir/<programName>`, (3) copy webview lib → `libDir`, (4) macOS icon + Info.plist. Uses `serverBuildPlugins({ cwd, svelteConfig })`. **KEEP all of this.**
- `packages/abide/src/appEntry.ts` — the launcher entry (compiled). Currently: reads `process.env.APP_URL`; if set → `openWebview(remoteUrl)`; else → `findFreePort()` → spawn `resolveServerBinary()` with `PORT` → `waitForServer(url)` → `openWebview(localUrl)`. Imports the `abide:bundle-window` virtual as `bundleWindow`. **THIS IS THE MAIN REWRITE.**
- `packages/abide/src/lib/bundle/openWebview.ts` — FFI `dlopen` of webview lib. Currently binds: `webview_create`, `webview_set_title`, `webview_set_size`, `webview_navigate`, `webview_run`, `webview_destroy`. Calls `installMacMenu(libPath, handle, title, menu)` before `webview_run`. **We need the live `handle` + `libPath` available to the control server so it can navigate the window from another thread/callback — see "Threading" below.**
- `packages/abide/src/lib/bundle/installMacMenu.ts` — opens its own short-lived dlopen handle for `abide_install_app_menu(webviewHandle, configJsonPtr)`. Config is `JSON.stringify({ appName, menu })`.
- `packages/abide/src/lib/bundle/native/abideMenu.mm` — the native menu shim (~221 lines). Has `AbideMenuAction` with `connect:` (NSAlert prompt → `webview_navigate`) and `emit:` (`webview_eval` dispatch of `abide:menu` CustomEvent). `buildBundleMenu` builds custom menus from JSON `{label, items:[{separator}|{label,shortcut,emit}]}`. `abide_install_app_menu` builds App/File(Connect)/Edit/<custom>/Window. **REWRITE the File→Connect into a Server menu; add `navigate` action + `validateMenuItem:` gating.**
- `packages/abide/src/lib/bundle/native/webview.h` — vendored webview header. Exposes `webview_navigate`, `webview_eval`, `webview_init`, `webview_dispatch` (for cross-thread main-loop work). Note `webview_dispatch(w, fn, arg)` schedules a fn on the UI thread — important for navigating from the control server.
- `packages/abide/src/lib/bundle/buildWebviewLib.ts` — compiles `abideMenu.mm` + webview into the dylib. **If we add new exported native symbols (e.g. `abide_set_connected`), confirm the compile command picks up the same `.mm` (it already compiles abideMenu.mm, so new `extern "C"` exports in that file are automatically included). Re-read this file to confirm no symbol allow-list needs updating.**
- `packages/abide/src/lib/bundle/BundleWindow.ts` — `{ title?, width?, height?, menu? }`. **EXTEND with `connect?`.**
- `packages/abide/src/lib/bundle/BundleMenu.ts` — `{ label, items: BundleMenuItem[] }`. Keep.
- `packages/abide/src/lib/bundle/BundleMenuItem.ts` — `{ separator: true } | { label, shortcut?, emit }`. **EXTEND with a `navigate` variant.**
- `packages/abide/src/lib/bundle/findFreePort.ts` — `Bun.serve({port:0})` probe. Keep; we also need a **stable** port (new helper).
- `packages/abide/src/lib/bundle/waitForServer.ts` — polls a URL until it answers. Keep (used by Start server).
- `packages/abide/src/lib/bundle/resolveServerBinary.ts` / `serverBinaryFilename.ts` — locate/name the sibling server binary. Keep (Start server spawns it).
- `packages/abide/src/abideResolverPlugin.ts` — the virtual-module plugin. Virtuals are matched by an `onResolve` filter regex listing names, then an `onLoad` in namespace `NS` switch on `abide:<name>`. **ADD `bundle-disconnected` to BOTH the filter regex AND the onLoad switch.** Pattern to copy: `abide:cli-manifest` (reads a file from `dist/`, splices content) and `abide:bundle-window` (re-exports user file or default). The shell loader (`loadShell`) shows how user-override-or-default file selection + hashed-asset rewrite works.
- `packages/abide/src/serverBuildPlugins.ts` — server-target plugin pair (`sveltePlugin({generate:'server'})` + resolver). The launcher build uses this.
- `packages/abide/src/build.ts` — client build. Shows how a Svelte client bundle is produced (`sveltePlugin({generate:'client'})`, dedupe-svelte, tailwind, `Bun.build` target browser). **Model the connect-screen client build on this**, but single-file/inlined.
- `packages/abide/src/sveltePlugin.ts` — compiles `.svelte` with `css:'injected'`. Good — injected CSS means we can produce a single self-contained HTML file with no external CSS link.
- `packages/abide/src/assets/app.html` — the default shell, for tone/structure reference.

## Design decisions already settled with the user (do not relitigate)

1. **localStorage** persistence for the remote URL. Key: `abide:server-url`.
2. **Stable local port** so the connect screen's origin is constant across launches and localStorage survives. Derive deterministically from program name; fall back to random free port on collision.
3. **Connect** is the connect screen's job (form). **Disconnect/Switch** primarily via the **native menu**. (User dropped the injected `window.abide` JS bridge — do NOT add it.)
4. Connect screen defaults ship in `lib/bundle/` (like `app.html`), overridable at `src/bundle/disconnected.svelte`. Content: **icon/logo + package name + a "made with abide" footnote**, simple and elegant, Tailwind.
5. **Keep the full bundle** (launcher + compiled server + webview). Add **Start server** (spawns embedded server) as a button on the screen AND a menu item.
6. Menu items **enable/disable by connection state** via native `validateMenuItem:` driven by a launcher-set flag:
   - disconnected: **Start server** enabled; Connect/Disconnect disabled; custom `emit` items disabled.
   - connected: **Connect** (= switch) + **Disconnect** enabled; custom `emit` items enabled; Start disabled.
7. **`emit` contract unchanged.** Add **`navigate`** menu action alongside it (`webview_navigate`). `emit` talks to the loaded page; `navigate` moves the window.

## Architecture of the running launcher

```
appEntry (compiled launcher)
  ├─ derive stable port  → http://localhost:<port>   (the "control origin")
  ├─ start Bun.serve (control server) on that port:
  │     GET  /                      → serve baked connect screen HTML (action via ?action=)
  │     POST /connect {url}         → mark connected(remote) + reply { redirect: url }
  │     POST /start                 → findFreePort, spawn server binary, waitForServer,
  │     |                              mark connected(local), reply { redirect: localUrl }
  │     GET  /__abide/disconnect    → kill local child if any, mark disconnected,
  │                                    reply redirect to "/" (or the menu navigates here)
  │     (the connect page itself does localStorage; the server just tracks the bool/state
  │      and tells the webview where to go, and flips the native connected flag)
  ├─ openWebview(controlOrigin):
  │     create handle, set title/size, installMacMenu(..., menu, hasConnectMenu=true)
  │     keep `handle` + `libPath` so control server can navigate via webview_dispatch
  │     webview_run (blocks until window closed)
  └─ on close: kill local server child if running; process.exit(0)
```

### Threading (IMPORTANT)
`webview_run` blocks the main thread. The control server's fetch handlers run on Bun's
event loop (same process, async) — they must **not** call `webview_navigate` directly from
an arbitrary context; use `webview_dispatch(handle, fn, arg)` to marshal the navigate onto
the UI thread, OR simpler: have the **fetch handler return a `{ redirect }` JSON/302 and
let the connect page do `location.href=...` itself** (the page is already on the control
origin, so a normal navigation works and stays on the UI thread). Prefer the redirect
approach for `/connect` and `/start` (page-initiated). For the **menu** Disconnect, the
native side calls `webview_navigate` directly (already on UI thread in the menu action) to
`…/?action=disconnect`; the connect page then clears localStorage and the launcher learns
state via the page calling back, OR the menu also flips the flag natively. See "State sync"
below.

### State sync (connection flag)
Two places track "connected":
- **Native flag** (drives `validateMenuItem:`). Set via new export `abide_set_connected(int)`.
- **Launcher** knows transitions because connect/start/disconnect all pass through the
  control server.

Simplest correct wiring:
- Connect/Start: page POSTs → control server sets internal state, calls
  `abide_set_connected(1)` via FFI, returns redirect → page navigates to app.
- Disconnect (menu): native menu action navigates window to `…/?action=disconnect` **and**
  the same action calls the native flag set to 0 directly (it's native, synchronous). The
  connect page on load with `?action=disconnect` clears localStorage. The launcher also
  exposes `GET /__abide/state?connected=0` pinged by the connect page on load to keep the
  launcher's own child-process bookkeeping in sync (kill local child). 
  - **Decision for executor:** keep it robust — on `?action=disconnect`, connect page does
    `localStorage.removeItem` then `fetch('/__abide/disconnect')` so the launcher kills any
    local child and sets the flag 0 authoritatively. The native menu action only needs to
    `webview_navigate` to that URL; let the launcher be the source of truth for the flag.
    (This avoids FFI from the menu action for state — menu just navigates.)

So the native flag is set **only by the launcher via `abide_set_connected`** on every
transition. The menu actions are pure `webview_navigate`. Cleaner.

## File-by-file work

### 1. Types

**`packages/abide/src/lib/bundle/BundleMenuItem.ts`** (EDIT)
Add a `navigate` variant. Result union:
```ts
export type BundleMenuItem =
  | { separator: true }
  | { label: string; shortcut?: string; emit: string }
  | { label: string; shortcut?: string; navigate: string }
```
Update the doc comment to explain `navigate` moves the window (`webview_navigate`) vs `emit`
dispatching a page event.

**`packages/abide/src/lib/bundle/BundleConnect.ts`** (NEW)
One type, the connect-screen config:
```ts
export type BundleConnect = {
  title?: string        // heading; default = program name
  placeholder?: string  // URL field placeholder; default e.g. "https://…"
  defaultUrl?: string   // prefilled URL value
  // logo path is a build-time convention (src/bundle/logo.png), not a runtime field
}
```
(Doc comment describing each field + the override conventions.)

**`packages/abide/src/lib/bundle/BundleWindow.ts`** (EDIT)
Add `connect?: BundleConnect` and import the type. Update doc comment.

### 2. Stable port helper

**`packages/abide/src/lib/bundle/stableLocalPort.ts`** (NEW)
Pure function: deterministic port in the dynamic/private range (49152–65535) from the
program name, so localStorage origin is stable across launches.
```ts
// Derive a deterministic localhost port from the program name so the connect
// screen's origin (and thus its localStorage) is stable across launches.
// Hash → 49152 + (hash % 16384). Caller probes availability and falls back.
export function stableLocalPort(programName: string): number { … }
```
Use a small stable string hash (e.g. FNV-1a) — implement inline, pure.

**`packages/abide/src/lib/bundle/listenLocalControlServer.ts`** (NEW) — optional helper
A function that tries `Bun.serve({ port: stable, fetch })`; on `EADDRINUSE` retries with
`port: 0`. Returns the running server. Keep it small; or inline in appEntry. Executor's
call — prefer a named helper file per "one export per file."

### 3. Default connect screen (Svelte) + build

**`packages/abide/src/lib/bundle/disconnected.svelte`** (NEW)
Svelte 5 component. Reads config + logo injected as `window.__ABIDE_CONNECT__` (set by the
HTML wrapper, see below). Behavior:
- On mount (`$effect`): parse `?action=`. If `disconnect` → `localStorage.removeItem('abide:server-url')` then `fetch('/__abide/disconnect')` (best-effort). If no action and a saved URL exists and action !== 'switch' → `location.href = saved`. If `switch` → prefill from saved, don't auto-redirect.
- Form: URL `<input>` ($state), **Connect** button → `localStorage.setItem('abide:server-url', url)` then POST `/connect {url}` → on `{redirect}` do `location.href = redirect` (redirect will equal url; using the server keeps the connected flag authoritative).
- **Start server** button → POST `/start` → on `{redirect}` `location.href = redirect`. While starting, disable button + show "Starting…".
- Layout: centered card; **logo** (`<img>` from `window.__ABIDE_CONNECT__.logo` data URI if present, else a default abide mark or omit), **package name** as heading (`title`), URL field + Connect, Start server button, and a subtle footer "made with abide" (link to abide). Tailwind, simple/elegant, light theme matching `app.html` tone.
- All strings come from injected config with sensible fallbacks.

**`packages/abide/src/bundleDisconnectedEntry.ts`** (NEW)
Client entry that mounts `disconnected.svelte` into `#app` (mirror how `clientEntry.ts` +
`startClient` mount, but standalone — just `mount(Disconnected, { target })` from `svelte`).
Resolve the component as user-override (`src/bundle/disconnected.svelte`) or the lib default
via a small virtual `abide:bundle-disconnected-component`? **Simpler:** the entry imports a
virtual `abide:bundle-disconnected-component` that the resolver maps to the user file or the
lib default. Add that virtual too (see resolver section). Alternatively the build picks the
entry/component path directly without a virtual — executor's choice, but keep it consistent
with existing override patterns (resolver virtual is the idiom here).

**`packages/abide/src/buildDisconnected.ts`** (NEW)
Builds the connect screen into a single self-contained HTML string and writes
`dist/bundle-disconnected.html`. Steps (model on `build.ts`):
- `Bun.build({ entrypoints: [bundleDisconnectedEntry], target: 'browser', minify: true, plugins: [dedupeSvelte, sveltePlugin({generate:'client'}), abideResolverPlugin({cwd, target:'client'}), tailwind?] })` — **outdir to a temp** or read outputs in-memory.
- CSS is `injected` by sveltePlugin, so the JS bundle self-injects styles. If tailwind emits a separate CSS asset, inline it into a `<style>`.
- Read the logo: `src/bundle/logo.png` if present → base64 data URI; else use a bundled default `lib/bundle/assets/logo.png` (ship a small abide logo; if none available, executor may use an inline SVG default instead of a PNG — acceptable, document it).
- Read connect config from `src/bundle/window.ts` default export's `connect` (or just let the runtime component read injected config; the build only needs the logo + title fallback = package name). Inject `window.__ABIDE_CONNECT__ = {...}` as a `<script>` before the bundle.
- Compose final HTML (doctype, head with `<meta viewport>`, `<style>` if any, `<div id="app">`, the inline `<script type="module">` with the bundle JS, the config script). Write to `dist/bundle-disconnected.html`.
- Export `async function buildDisconnected({ cwd, svelteConfig }): Promise<string>` returning the path.

> NOTE on inlining JS: produce the browser bundle, then embed its text inside
> `<script type="module">…</script>`. Watch for `</script>` in the bundle (rare but
> escape `<\/` defensively). Keep it one file so the launcher can serve it with zero
> external requests, OR serve assets from the control server. **Simplest: one inlined HTML
> file served at `/`.**

### 4. Resolver virtuals

**`packages/abide/src/abideResolverPlugin.ts`** (EDIT)
- Add `bundle-disconnected` (the baked HTML) and, if used, `bundle-disconnected-component`
  to the `onResolve` filter regex (the long alternation listing virtual names).
- In the `onLoad` namespace switch add:
  - `abide:bundle-disconnected` → read `${cwd}/dist/bundle-disconnected.html`; if missing, export a minimal fallback HTML string; else `export const disconnectedHtml = ${JSON.stringify(html)}`. (Pattern: `abide:cli-manifest`.)
  - `abide:bundle-disconnected-component` (if chosen) → if `src/bundle/disconnected.svelte` exists, `export { default } from "<userfile>"`; else `export { default } from "<lib default>"`. (Pattern: `abide:bundle-window`, but pointing at a `.svelte` — make sure the svelte loader handles it; it will, both are plugins on the same build.)
- Keep the existing `log.info('using custom …')` style messages on override.

### 5. The launcher rewrite

**`packages/abide/src/appEntry.ts`** (REWRITE)
- Import the baked `abide:bundle-disconnected` html, `abide:bundle-window`, `abide:cli-name` (program name), the new helpers (`stableLocalPort`, `findFreePort`, `waitForServer`, `resolveServerBinary`), `openWebview`, `installMacMenu` machinery, `log`.
- Read `bundleWindow` (title/size/menu/connect).
- Compute `programName` (from `abide:cli-name`).
- `port = pick stable port, bind control server` (handle EADDRINUSE → port 0).
- Build the **default Server menu** (Start server / Connect… / Disconnect) as `navigate`
  items pointing at `http://localhost:<port>/?action=start|switch|disconnect` — BUT Start
  and Connect are better as POSTs from the page; for the **menu** use navigate URLs that the
  connect page interprets, OR have the menu Start/Connect just navigate to `/` and `/` shows
  the form (Connect) — keep menu semantics:
  - **Start server** → `navigate` `…/?action=start` → connect page auto-POSTs `/start`.
  - **Connect** (switch) → `navigate` `…/?action=switch` → form prefilled.
  - **Disconnect** → `navigate` `…/?action=disconnect` → page clears + `/__abide/disconnect`.
  Merge this default Server menu with the user's custom `menu` (Server menu first/between Edit
  and custom — executor: insert Server menu as the first custom-style menu, then user menus).
- Pass to `installMacMenu` the combined menu + a flag indicating the connect/server items
  exist so native gating applies. (See native section for the exact contract.)
- `openWebview({ url: controlOrigin, title, width, height, menu, libPathOut })` — we need the
  webview `handle` + `libPath` accessible for `abide_set_connected`. **Refactor `openWebview`**
  to accept an `onReady?(ctx: { handle, libPath, setConnected(connected:boolean):void })`
  callback invoked after create + menu install, before `webview_run`. The control server
  closures capture `setConnected` to flip the native flag. `setConnected` does a dlopen of
  `abide_set_connected` (or reuse openWebview's symbol table — better: bind
  `abide_set_connected` inside openWebview's `dlopen` map and expose via the ctx).
- Control server fetch handler:
  - `GET /` → return `disconnectedHtml` (text/html). (Action handling is client-side via `?action=`.)
  - `POST /connect` → body `{ url }`. `setConnected(true)`; respond `{ redirect: url }`.
  - `POST /start` → `const p = findFreePort(); spawn server binary with PORT=p; await waitForServer(localUrl)`; store child ref; `setConnected(true)`; respond `{ redirect: localUrl }`. On failure respond 500 `{ error }`.
  - `GET /__abide/disconnect` → kill local child if running; `setConnected(false)`; respond 200 (or 302 to `/`).
  - 404 otherwise.
- On `webview_run` return (window closed): kill child if running; `process.exit(0)`.
- Keep `SIGINT`/`SIGTERM` → kill child + exit.
- **Remove the old `APP_URL` remote/embedded branch.** (Optional: still honor `APP_URL` as a kiosk override that skips the connect screen entirely and disables the Server menu — NICE TO HAVE, not required. If kept, document it. Default plan: drop it for clarity, connect screen is the entry. Confirm with maintainer if unsure; safe default = drop.)

**`packages/abide/src/lib/bundle/openWebview.ts`** (EDIT)
- Add `abide_set_connected: { args: [FFIType.i32], returns: FFIType.void }` to the `dlopen`
  symbol map (guard: it only exists on macOS build of the lib — calling it where absent
  should no-op; on non-darwin the symbol may be missing → wrap the FFI lookup so a missing
  symbol doesn't throw. Simplest: try/catch the dlopen with the extra symbol; if it throws,
  dlopen without it and make `setConnected` a no-op. OR add the export on all platforms in
  the `.mm`/build — but the `.mm` is Cocoa-only. Provide a no-op fallback.)
- Add `onReady?` param; after `installMacMenu` and before `webview_run`, call
  `onReady({ handle, libPath, setConnected })` where `setConnected(c)` calls the symbol
  (no-op if unavailable).
- Keep blocking `webview_run` semantics.

### 6. Native menu (`abideMenu.mm`) (REWRITE portions)

- Add a process-global atomic/bool `g_abide_connected` (default false) and export:
  ```c
  extern "C" ABIDE_EXPORT void abide_set_connected(int connected);
  ```
  setting the bool (and ideally `[menu update]`/`NSApp` revalidates on next open
  automatically — menu validation runs each time a menu opens, so just storing the bool is
  enough).
- Extend `AbideMenuItem` handling in `buildBundleMenu`: support a `navigate` key →
  action `@selector(navigateTo:)`; store the URL on the action object; `navigateTo:` calls
  `webview_navigate(webviewHandle, url)`.
- Add `validateMenuItem:` to `AbideMenuAction`:
  - For `emit` items → enabled iff `g_abide_connected`.
  - For `navigate` items, gate by a per-item "role" so Start/Connect/Disconnect follow the
    truth table. Encode role on the action: e.g. an enum `{none, start, connect, disconnect}`
    parsed from a `role` field in the item JSON (the launcher sets `role` on the Server menu
    items; user `navigate` items have no role → always enabled, OR gate like emit — decide:
    **user navigate items = always enabled**; only roled items gate).
  - Truth table: disconnected → start enabled, connect/disconnect disabled, emit disabled;
    connected → connect/disconnect enabled, start disabled, emit enabled.
- Replace the old hardcoded **File → "Connect to Server…"** NSAlert item with the new
  **Server** menu built from the launcher-provided config (Start/Connect/Disconnect roled
  navigate items). The old `connect:` NSAlert method can be removed (the Svelte screen is
  the connect UI now). Keep App/Edit/Window menus as-is.
- Update `abide_install_app_menu` config parsing: it now receives the Server menu among
  `menu` (the launcher builds it), OR a dedicated `serverMenu` field — executor: simplest is
  the launcher passes the Server menu as the first entry in `menu` with roled items, and the
  native code treats `role` on items generically. Document the JSON shape in the `.mm`
  comment and in `installMacMenu.ts`.
- Update `BundleMenuItem` JSON contract doc to include `navigate` and optional `role`
  (`role` is internal — used by launcher-built items; not part of the public user-facing
  `BundleMenuItem` type, OR expose it. Keep `role` internal: it's set only by the launcher's
  generated Server menu, so it can be an extra field the native side reads but the public TS
  type doesn't advertise. If TS complains, model the launcher's internal menu with a local
  type that extends BundleMenuItem with `role`.)

**`packages/abide/src/lib/bundle/installMacMenu.ts`** (EDIT)
- No signature change needed if the Server menu is folded into `menu`. Update the doc
  comment to mention `navigate`/`role` and `abide_set_connected`. Ensure JSON serialization
  includes any `navigate`/`role` fields (it uses `JSON.stringify({appName, menu})` — fine, as
  long as the menu objects carry the fields).

### 7. bundleApp wiring

**`packages/abide/src/bundleApp.ts`** (EDIT)
- After `compile()` (or alongside the launcher build), call `buildDisconnected({ cwd, svelteConfig })` so `dist/bundle-disconnected.html` exists **before** the launcher build (the launcher's `abide:bundle-disconnected` virtual reads that file at build time). Order: build disconnected HTML → build launcher (which bakes it in) → copy webview lib → icon/plist.
- Keep everything else (server binary, webview lib copy, icon, plist).

### 8. CLI help

**`packages/abide/bin/abide.ts`** (EDIT)
- Update the `bundle` line in `usage()` to mention it boots a connect screen (Start server /
  connect to remote). No new flags required (no `--remote`; we keep full bundle). If kiosk
  `APP_URL` override is kept, mention it; otherwise leave as is.

## Build-order dependency (critical)

The launcher bundle bakes in `abide:bundle-disconnected` which reads
`dist/bundle-disconnected.html`. So in `bundleApp`:
1. `compile()` server binary (writes server; also runs client `build()` which **rm -rf dist** first — so `buildDisconnected` MUST run AFTER `compile()`/`build()` cleared dist, not before).
2. `buildDisconnected()` → writes `dist/bundle-disconnected.html`.
3. build launcher (`appEntry.ts`) → reads the html virtual.
4. copy webview lib, icon, plist.

Double-check: `build.ts` does `rm -rf ${distDir}` at the start. `compile()` calls `build()`.
So sequence: compile (clears dist, writes _app + server) → buildDisconnected (writes html) →
launcher build. **Confirm `buildDisconnected` does NOT itself rm -rf dist** (it must not —
use a temp dir for its own Bun.build outputs, then write only the final html into dist).

## Testing / verification (executor must do)

The user does NOT want long-lived `bun run dev`. To verify:
1. **Typecheck/build the package**: from repo root, `bun run` the package's build/typecheck
   script if present (check `packages/abide/package.json` scripts). At minimum ensure
   `bunx tsc --noEmit` (or the repo's typecheck) passes for the package.
2. **Build the example bundle** to exercise the path end-to-end:
   `cd examples/kitchen-sink && bunx abide bundle` (or the linked bin). Confirm:
   - `dist/bundle-disconnected.html` is produced and is self-contained (open it in a browser
     manually / `Bun.file().text()` and sanity check it has the inlined script + config).
   - The `.app`/dir contains launcher + `server` + webview lib.
   - Native lib compiled with the new `abide_set_connected` symbol (nm/`Bun.dlopen` probe, or
     just that `abide bundle` completed without a link error).
3. **Smoke the launcher** if on macOS: run the launcher binary, confirm the connect screen
   appears, Connect to a URL navigates, Start server boots the embedded server and navigates,
   Disconnect returns to the screen, and the Server menu items enable/disable per state.
   (If headless, at least confirm the control server responds: the executor can temporarily
   run the control-server logic in isolation, or trust the build + manual note that GUI
   verification needs a desktop session.)
4. Run `bun format` on all touched files.
5. Do NOT commit or push unless explicitly asked.

## Out of scope (do NOT do)

- No README changes. No example changes beyond what's strictly needed to verify (and if you
  must touch `examples/kitchen-sink/src/bundle/` to test, revert it after — but prefer not to;
  the default lib screen should work with zero project files).
- No injected `window.abide` JS bridge (user dropped it).
- No new CLI flags / no remote-only build mode.
- Don't touch the cache/subscribe/rpc/socket/prompt subsystems.

## Acceptance criteria

- `abide bundle` produces a full bundle that boots into a styled connect screen (logo +
  package name + "made with abide" footnote) instead of a blank window.
- Connect-by-URL works and persists across relaunch via localStorage (stable port).
- Start server boots the embedded server and navigates to it.
- Disconnect (menu) returns to the connect screen and clears state.
- Server menu items (Start / Connect / Disconnect) and custom `emit` items enable/disable
  per the connection-state truth table.
- `emit` menu contract unchanged; `navigate` action added.
- All new files: one export each, named after the file, Bun/native-JS APIs, Svelte 5,
  Tailwind, braces on ifs, `undefined` over null, descriptive comments. `bun format` clean.
```
