# @briancray/belte

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
