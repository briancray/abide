# @briancray/belte

## 0.9.1

### Patch Changes

- [#33](https://github.com/briancray/belte/pull/33) [`e8c6d74`](https://github.com/briancray/belte/commit/e8c6d74be8c4033c58fb4b23fd1861a68df640ca) Thanks [@briancray](https://github.com/briancray)! - Root-absolute `url()` references in bundled stylesheets (e.g. `url(/fonts/x.woff2)`) are now marked external instead of being resolved against the project root at build time. Those paths are served from `public/` at the site root at runtime, so Bun's CSS bundler previously failed the whole build trying to find them on disk. The literal `/…` path now survives into the emitted CSS, where the public asset server serves it. Relative `url()`s still resolve and bundle as before.

## 0.9.0

### Minor Changes

- [#31](https://github.com/briancray/belte/pull/31) [`7f43099`](https://github.com/briancray/belte/commit/7f43099e6d9bab1d3de50b37ce241c4b3e171849) Thanks [@briancray](https://github.com/briancray)! - The standalone CLI (`belte cli`) now ships the compiled server beside it and gains an interactive session. `<app> /connect <url>` connects to a remote server, `<app> /start` boots a local instance, `<app> /disconnect` forgets the saved connection, and `<app>` alone resumes it — each opening a prompt where bare words run RPC commands and `/connect` / `/start` / `/disconnect` / `/help` / `/exit` manage the connection. One-shot dispatch (`<app> <command> --flags`) is unchanged for scripting. The connection is remembered in the per-user data dir; with none saved the CLI uses the baked `APP_URL`. The download tarball now bundles the server binary so `/start` works out of the box.

- [#31](https://github.com/briancray/belte/pull/31) [`9f4500a`](https://github.com/briancray/belte/commit/9f4500a953579534088396c11da14538b56edb65) Thanks [@briancray](https://github.com/briancray)! - `belte bundle` now reads the shipped default-config file from `bundle.env` instead of `.env.bundle`. The old name masqueraded as a member of Bun's `.env.*` autoload family, implying `bun dev`/`bun start` would load it (they never did) and that it should be gitignored like `.env` (it should be committed — it's ship-safe defaults, and a compiled bundle is extractable anyway). The new name reflects what the file is: a build input, not a runtime env overlay. Rename your project's `.env.bundle` to `bundle.env`.

### Patch Changes

- [#31](https://github.com/briancray/belte/pull/31) [`a03d4ac`](https://github.com/briancray/belte/commit/a03d4acfbc6e2d596a9d7e9481fb91e437378ca7) Thanks [@briancray](https://github.com/briancray)! - `belte dev` and `belte start` no longer load the bundle's config layers (the per-user data-dir `.env` and the shipped binary-dir `bundle.env`). Those layers exist for the compiled standalone app — a bundle launched via `open` has cwd `/` and gets its config there — but the server entry loaded them unconditionally, so dev/start would also inherit them. A `PORT` saved in the data-dir `.env` (written by a bundle's connect screen) then defeated dev's auto port-scan, binding that exact port and throwing `EADDRINUSE` instead of moving on. Dev/start now keep to their project-local CWD `.env` alone; the data-dir/binary-dir layers load only when running as a `bun build --compile` standalone binary.

## 0.8.1

### Patch Changes

- [#29](https://github.com/briancray/belte/pull/29) [`f85ee72`](https://github.com/briancray/belte/commit/f85ee722cd2b659aad7d8f250ae595b0b2ccdcae) Thanks [@briancray](https://github.com/briancray)! - With no `PORT` set, the server now scans upward from 3000 at bind time, binding the listener that wins the port instead of probing a throwaway server and releasing it first. This closes the gap where the chosen port could be stolen between probe and bind, which crashed boot on `EADDRINUSE` rather than stepping to the next port. A configured `PORT` still binds that exact port and surfaces a collision loudly.

## 0.8.0

### Minor Changes

- keep streams alive past Bun's idle timeout ([`9339175`](https://github.com/briancray/belte/commit/9339175a4b73d336704bbd8ff61ecf88f8582cfa))

- [#27](https://github.com/briancray/belte/pull/27) [`78305d1`](https://github.com/briancray/belte/commit/78305d18392cd916e39475a37eaafc486d3cdabf) Thanks [@briancray](https://github.com/briancray)! - Streaming responses (sse / jsonl / socket SSE tail) now opt out of Bun's per-connection idle timeout, so a stream that stays quiet between frames is no longer closed mid-flight. A new `idleTimeout` option (and `BELTE_IDLE_TIMEOUT` env, 0–255 seconds, default 10) sets the floor for ordinary unary handlers that legitimately compute longer than Bun's 10s default.

### Patch Changes

- dedup env-int parsing and route-dispatch 405s ([`617cc3c`](https://github.com/briancray/belte/commit/617cc3c0c5a763cd8d5e8c4bb0e74ee852500a94))

- extract route dispatch into a testable createRouteDispatcher ([`a684227`](https://github.com/briancray/belte/commit/a6842275a3fa444162571c6fccfcbadd13b712a5))

- extract request-scope runner into a testable seam ([`ce6f65c`](https://github.com/briancray/belte/commit/ce6f65c6cde3f070d4d55574979d21b362765aee))

## 0.7.0

### Minor Changes

- [#23](https://github.com/briancray/belte/pull/23) [`46f62ef`](https://github.com/briancray/belte/commit/46f62efebcdd9415b97435f17a70c91a0319a402) Thanks [@briancray](https://github.com/briancray)! - `cache()`'s `scope` option now accepts an array of tags, not just a single tag, so a call can join multiple invalidation groups (`scope: ['media', 'sources']`). `cache.invalidate({ scope })` drops every entry sharing any of the requested tags, and a re-read merges new tags into an entry rather than replacing them.
  </content>
  </invoke>

## 0.6.0

### Minor Changes

- [#21](https://github.com/briancray/belte/pull/21) [`5fbf023`](https://github.com/briancray/belte/commit/5fbf023c7de46457ae652c1738613ee2ceaf7dd7) Thanks [@briancray](https://github.com/briancray)! - `cache()` gains a `scope` option, and `cache.invalidate({ scope })` drops every entry sharing that tag in one call. `cache.invalidate` now takes `() | (fn) | ({ key?, scope? })`.

- [#21](https://github.com/briancray/belte/pull/21) [`56cd195`](https://github.com/briancray/belte/commit/56cd1950cf39e13dd06c90309efd35296c6c7e81) Thanks [@briancray](https://github.com/briancray)! - Breaking: `belte/cli/*` is no longer a public export — `createClient` is now internal. Nothing in the documented API referenced it.

- [#21](https://github.com/briancray/belte/pull/21) [`6776396`](https://github.com/briancray/belte/commit/67763968b13dd88173aeaf42242df6239fdc713b) Thanks [@briancray](https://github.com/briancray)! - When `PORT` is unset, the server now binds the first open port at or above 3000 instead of hardcoding 3000, so a second app boots without colliding. An explicit `PORT` is still honored as-is.

## 0.5.3

### Patch Changes

- extract shared build helpers and centralize bundle layout ([`64d71de`](https://github.com/briancray/belte/commit/64d71de9d4b28130775545f1047fa985545b3aaa))

- [#18](https://github.com/briancray/belte/pull/18) [`90a1713`](https://github.com/briancray/belte/commit/90a17136f53bab6f860c486e415547364fd54ca5) Thanks [@briancray](https://github.com/briancray)! - Extract repeated build-time logic into single-purpose shared helpers and collapse the per-virtual manifest codegen. `manifestModule` builds the `belte:rpc`/`sockets`/`prompts`/`pages`/`layouts` virtual modules from one path; `bundleLayout` derives `libDir`/`resourcesDir`/`envPath` from `binDir` (replacing the narrower `shippedEnvPath`) so the build writer and boot readers agree; `readPackageJson`, `exeSuffix`, `browserClientFlags`, and `memoizeByKey` deduplicate the package.json reader, the windows `.exe` suffix, the browser proxies, and the server route loaders. No public API change; behaviour preserved.

## 0.5.2

### Patch Changes

- [#15](https://github.com/briancray/belte/pull/15) [`7e3c96c`](https://github.com/briancray/belte/commit/7e3c96cd969e3f59c4be0e773478e56d21688874) Thanks [@briancray](https://github.com/briancray)! - Ship the bundle's `.env` under `Contents/Resources/` in a macOS `.app` instead of `Contents/MacOS/`. `codesign` seals `Contents/MacOS/` as code, so a data file there couldn't survive signing and reloading; `Resources` is sealed as a resource. A new `shippedEnvPath` helper centralizes the layout so the build writer and both boot readers agree on the path. The flat (non-macOS) layout is unchanged.

## 0.5.1

### Patch Changes

- [#12](https://github.com/briancray/belte/pull/12) [`47ecf72`](https://github.com/briancray/belte/commit/47ecf72c0a112461eacc9e1cd406e743c95423c5) Thanks [@briancray](https://github.com/briancray)! - A bundle's embedded server now honors a configured `PORT` instead of always picking a random free port. The launcher resolves `PORT` from the same env stack the server uses (shell, then the data-dir `.env` the config form writes, then the shipped binary-dir `.env`) and binds it as-is; with none set it falls back to a free port as before. This lets you start the embedded server at a fixed, known address on one machine and reliably connect to it from another via the connect screen.

## 0.5.0

### Minor Changes

- [#10](https://github.com/briancray/belte/pull/10) [`6ceb71b`](https://github.com/briancray/belte/commit/6ceb71b28e3b1a4c9726483d2c7dd3f40be3be59) Thanks [@briancray](https://github.com/briancray)! - Bundles now resolve config from a cwd-independent source instead of relying on Bun's cwd-based `.env` autoload (which a launched `.app`, whose cwd is `/`, silently misses). Config flows entirely through `process.env`, so app code keeps reading `Bun.env.*` and never learns where a value came from.

  - The compiled server loads two `.env` layers into `process.env` at boot, before anything reads it: the per-user data dir first (user config), then the binary dir (shipped default). Both back-fill only what a shell export or Bun's CWD `.env` didn't already set, so the precedence is `shell > CWD .env > data-dir .env > binary-dir .env > code default`.
  - Add `belte/shared/appDataDir` — the platform-standard per-user data directory keyed by program name, where the data-dir `.env` lives.
  - `belte bundle` ships an optional project `.env.bundle` as the binary-dir `.env` (the shipped default layer). Skipped when absent; use a dedicated file, never the working `.env`, since a compiled bundle is extractable.
  - Start now races server readiness against the child's exit, so a misconfigured bundle reports the crash immediately instead of stalling for the full readiness timeout.
  - A bundle resolves its last connection before the window opens: the launcher records the choice (embedded, or a remote URL) in the data dir, and on relaunch boots/probes it first, opening the window straight at the live server — so the connect screen never flashes. A boot that fails or exceeds a short ceiling, an unconfigured embedded resume, a dead saved server, or no saved choice falls back to opening the connect screen.
  - A bundle can declare `config` on its `BundleWindow` as a Standard Schema (the same kind belte accepts for RPC/MCP). Its JSON Schema drives a first-run settings modal on the connect screen — `title` → label, `description` → hint, `format: 'password'` → masked input, `default` → prefill — and answers persist to the data-dir `.env`. An explicit Start (button or File-menu click) always opens the modal prefilled with the last-used values, so re-running Start after a disconnect is how you reconfigure; an auto-start on relaunch never opens the modal — it boots a fully-configured app, or stays on the connect screen when a required key is still unset. Apps with no schema always boot straight through.

### Patch Changes

- harden PORT parsing and make shutdown signal-safe ([`9cca848`](https://github.com/briancray/belte/commit/9cca848b08a786b6abfe7920d4775a1f76c11fe6))

## 0.4.0

### Minor Changes

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - `belte bundle` now ad-hoc code-signs the assembled macOS `.app` so it launches on other Macs instead of being silently killed by Gatekeeper. A quarantined copy may still need `xattr -cr` once; full distribution still requires a Developer ID signature and notarization.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - The native webview inspector in a bundle is now gated behind `BELTE_INSPECT`, so release bundles ship without DevTools while debugging remains one env var away.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - `cache()` now returns synchronously for keys already warm in the SSR hydration snapshot, so the first client read of server-rendered data skips the microtask round-trip.

- [`d0a733d`](https://github.com/briancray/belte/commit/d0a733dd238e634baa1dd9fdf0adf99114612893) - Add a name-filtered `onMenu(name, handler)` overload alongside the existing catch-all `onMenu((name) => …)` form, so a bundle menu item can bind one handler without switching on the emit name.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - **Breaking:** verb helpers now take `inputSchema` (and optional `outputSchema`) instead of `schema`. `inputSchema` validates incoming args and feeds OpenAPI params / the MCP tool input; `outputSchema` describes the success body for the OpenAPI `200` response and MCP tool output. Client exposure (`browser` / `mcp` / `cli`) now defaults per-surface from the schema — read-only verbs auto-expose to MCP, mutating verbs opt in via `clients`. Migrate by renaming `{ schema }` to `{ inputSchema }`.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Sockets are now exposed to MCP and the CLI over an HTTP face: each schema-bearing socket contributes a `<name>-tail` read tool/command, plus `<name>-publish` when `clientPublish` is set.

### Patch Changes

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Public asset paths are snapshotted on disk at boot rather than stat'd per request, and browser-only routes are logged at startup.

- [`a432d00`](https://github.com/briancray/belte/commit/a432d00d3c58dea7f4968307e9c82590ff07ef8a) - Scaffolded apps now ship a default `src/bundle/icon.png`, so `belte bundle` produces an icon'd macOS `.app` out of the box.

## 0.3.1

### Patch Changes

- [`63fe0b6`](https://github.com/briancray/belte/commit/63fe0b6cdec4d1073252a68c8185f86b74ebe48e) - Default bundle connect screen now follows the OS dark-mode setting. Added
  Tailwind `dark:` variants (driven by `prefers-color-scheme`) across the
  background, card, input, buttons, divider, and footer — all grayscale except the
  red error message. A project that ships its own `src/bundle/disconnected.svelte`
  is unaffected.

## 0.3.0

### Minor Changes

- [`3daa1cd`](https://github.com/briancray/belte/commit/3daa1cdf793ddca5efdce8027293003d177b4a48) - Bundle (macOS webview): support file downloads. The webview now installs a
  navigation + download delegate, so `<a download>`, blob:/data: links, and
  `Content-Disposition: attachment` responses save a real file to the user's
  Downloads folder and reveal it in Finder — previously the bare WKWebView set no
  navigation delegate and silently dropped them. No-op on macOS before 11.3.

## 0.2.2

### Patch Changes

- [`465928b`](https://github.com/briancray/belte/commit/465928b411b8f8aff582df87f9e2ba3782d8b275) - The generated route-types file (`src/.belte/routes.d.ts`) now augments the `Routes` interface on the module name the project imports belte under (canonical `@briancray/belte` or an alias), matching the rpc/socket/prompt codegen. It previously hardcoded `belte/browser/page`, so `page.route` / `page.params` autocomplete only resolved when belte was installed under the `belte` alias.

## 0.2.1

### Patch Changes

- [`1d84fb8`](https://github.com/briancray/belte/commit/1d84fb8d64d8bb7b4d0eb3b1d24e0ea2f18b4c31) - RPC, socket, and prompt codegen now emit imports under the name belte is installed as in the consuming project — the canonical `@briancray/belte` for a direct dependency, or the alias key for a package alias (`"belte": "npm:@briancray/belte@..."`) — instead of a hardcoded `belte`. A plain `bun add @briancray/belte` now builds with no alias required; the `belte` alias remains supported for the bare `belte/...` import surface.

## 0.2.0

### Minor Changes

- [`cf136c7`](https://github.com/briancray/belte/commit/cf136c7b763283570ef431b3aad269626bea7824) - Add a `belte bundle` desktop app and make the CLI a thin remote-only client.

  - `belte bundle` assembles a movable, self-contained desktop app (a `.app` on macOS, a flat dir elsewhere) that boots into a connect screen — start the embedded server or connect to a remote one by URL.
  - **Breaking:** the CLI binary is now always a thin remote client (talks to a running server over HTTP, `APP_URL` required). Dropped the `--thin`/full split and in-process fallback — use `belte bundle` for the embedded-backend case.
  - **Breaking:** MCP prompts are now markdown files (`src/mcp/prompts/**.md`) with YAML frontmatter, replacing the `.ts` prompt modules.
  - **Breaking:** handlers read the inbound request via `request()` and the live server via `server()` rather than `RequestStore` fields.
  - `json` / `jsonl` / `sse` / `error` / `redirect` accept a trailing `ResponseInit`.
  - Static-asset header caching is shared across asset servers, and zstd decompression moved to the async API.

## 0.1.0

### Minor Changes

- [`c863e56`](https://github.com/briancray/belte/commit/c863e563338fe704fc96a7054e27a35d271261fb) - Initial public release of belte — an isomorphic multimodal HTTP framework for Bun and Svelte. Declare a backend once and consume it over the web (SSR Svelte), the CLI, and MCP.
