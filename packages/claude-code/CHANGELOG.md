# @belte/claude-code

## 0.5.1

### Patch Changes

- [`b28d167`](https://github.com/briancray/belte/commit/b28d1672a06d93daf7470452379139758854a1db) - pin the serve command to this bundle's version ([`b03d1af`](https://github.com/briancray/belte/commit/b03d1afca3e1a60263ed57fca0dee42a9c4a4b39))

## 0.5.0

### Minor Changes

- [`9cbca7d`](https://github.com/briancray/belte/commit/9cbca7d28c258d4574ac450811628f107e502711) - Bundle apps auto-start the local assistant. When a bundled belte app connects (embedded or remote) and the app ships `@belte/claude-code` (its UI uses `browser/assistant`) with `claude` on PATH, the bundle launcher runs the loopback bridge for you and hands the page its port+token via the URL fragment — no copy-paste command. The bridge is loopback-only and dies with the connection. belte takes **no dependency** on `@belte/claude-code`: it's a guarded optional import that no-ops (and compiles fine) when the app doesn't ship it.

  `assistant()` gains a `status` — `'ready' | 'starting' | 'manual' | 'unavailable'` — so the same UI works in a browser (`manual` → show `command`) and a bundle (`starting`/`ready` auto-managed, or `unavailable` when `claude` isn't installed → show an install hint). `command` is now `string | undefined` (undefined whenever a host manages the bridge).

- [`aca78cc`](https://github.com/briancray/belte/commit/aca78cc726e71a85e37dc654693243893d4627e4) - `serve` and `launch` now drive your installed `claude` binary instead of the bundled SDK, so `bunx @belte/claude-code serve` (and `launch`) need only Bun and `claude` on PATH — the serve bridge has **zero runtime dependencies**. `@anthropic-ai/claude-agent-sdk` is no longer a hard dependency: it's an optional peer, required only by the SDK-backed `engine()` (embedded server-side `agent()` where there's no local `claude`); install it explicitly for that path.

  A new internal `cliEngine` drives `claude -p --output-format stream-json` over the same MCP contract and isolation as the SDK engine, sharing the message→frame mapping. Note: `launch`'s `permissions` option is now `permissionMode`.

### Patch Changes

- [`e9217c9`](https://github.com/briancray/belte/commit/e9217c94e505f7b94fc46143068d3b7a75bf2342) - `serve` ends shortly after the last subscriber disconnects, so `bunx @belte/claude-code serve` doesn't linger once you close the tab. Exposed as `onIdle`/`idleGraceMs` (the bin exits 30s after the page closes; a reload reconnects within the grace and cancels it). Only armed after the first connection, so the bridge waits indefinitely for the page to first appear; programmatic `serve()` callers omit `onIdle` to stay resident.

## 0.4.0

### Minor Changes

- [`c93735a`](https://github.com/briancray/belte/commit/c93735ac8985a1a86036b1c9707994f6fbe96a14) - Add local-assistant surfaces alongside the `agent()` engine, all over the app's MCP surface:

  - `bunx @belte/claude-code` launches the interactive `claude` TUI wired to your local app's MCP (`--url` retargets a deployed app); `bunx @belte/claude-code serve` runs a loopback bridge so a remote site's browser can drive the user's local Claude.
  - `@belte/claude-code/browser/assistant` — reactive `assistant(config)` handle over a loopback WebSocket: `available` is the connection being open (no polling), `ask(messages)` returns a `Subscribable` of accumulating reply snapshots for `subscribe(assistant.ask(messages))` (dedupes by conversation, so the run doesn't re-fire on re-render), and `command` is the copy-paste first-run hint. Capabilities/systemPrompt are page-side _requests_ only; tools/permissions stay user-controlled in `serve` (default `tools: []`). The browser↔bridge channel is WebSocket; Claude→app MCP stays HTTP.
  - `@belte/claude-code/serve` and `@belte/claude-code/launch` exported for programmatic use.
  - The app's MCP server is now registered under its own `serverInfo.name` as `mcp__<appname>__*` (discovered via a pre-flight `initialize`, scope kept and sanitized) instead of the hardcoded `mcp__app__*`, so multi-site sessions no longer collide.
  - The engine now streams text token-by-token (`includePartialMessages`) instead of one frame per completed turn, matching the `@belte/anthropic` engine's live-delta cadence.

### Patch Changes

- Updated dependencies [[`946b6c4`](https://github.com/briancray/belte/commit/946b6c44b09ca30f28f4ab38d43ad5f9db452c2a), [`946b6c4`](https://github.com/briancray/belte/commit/946b6c44b09ca30f28f4ab38d43ad5f9db452c2a)]:
  - @belte/belte@0.19.4

## 0.3.0

### Minor Changes

- [`e5f5344`](https://github.com/briancray/belte/commit/e5f5344d17e672fa4dc4b231e755f724cf5c4cc5) - settings-shaped permissions, tool gating, and tool_result frames ([`a00bb92`](https://github.com/briancray/belte/commit/a00bb923b57cadf1e6109e7408f24ebc000a32bb))

## 0.2.1

### Patch Changes

- [`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5) - surface abnormal engine stops and bound the tool loops ([`d2c3215`](https://github.com/briancray/belte/commit/d2c3215bb50ba41b2407eb8878e426a164927d9d))

- Updated dependencies [[`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5), [`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5), [`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5)]:
  - @belte/belte@0.19.2

## 0.2.0

### Minor Changes

- [`d23c7ec`](https://github.com/briancray/belte/commit/d23c7ec542c180e611dd47c663cfc65319cb23ad) - `engine(config)` now controls Claude Code's posture with a single `permissionMode` option (`'default'` | `'acceptEdits'` | `'plan'` | `'dontAsk'` | `'bypassPermissions'`), replacing the `permission` allow/deny lists; `'bypassPermissions'` is wired with the SDK's required `allowDangerouslySkipPermissions` flag
