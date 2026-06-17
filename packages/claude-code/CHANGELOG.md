# @abide/claude-code

## 0.5.4

### Patch Changes

- rename project belte → abide ([`3ed697b`](https://github.com/briancray/abide/commit/3ed697bd3c804bdd79642d9edb5d3f3045ecdb53))

- tidy agent-engine import order (anthropic, claude-code) ([`ae05402`](https://github.com/briancray/abide/commit/ae05402f921fc7f62915abf378f10bde8e14637d))

- await stdin write so a large prompt isn't truncated ([`b6e9d3f`](https://github.com/briancray/abide/commit/b6e9d3fe76bf96ec8b66ccc5659ae8166bf580df))

- remove Svelte references across code, docs, and tooling ([`e77872a`](https://github.com/briancray/abide/commit/e77872ae3c1f799b5defba9b051ec35a3c6f5a88))

## 0.5.3

### Patch Changes

- [`ee6c2a3`](https://github.com/briancray/abide/commit/ee6c2a3e2f7506a77540ff12bc4c45d0f84dc083) - share claude CLI arg construction between engine and launch ([`434a6d7`](https://github.com/briancray/abide/commit/434a6d700c8b54f441d152c45965e3c8b39e106b))

## 0.5.2

### Patch Changes

- [`827fc54`](https://github.com/briancray/abide/commit/827fc54ec875fa931ad0edc6128a594763785dbb) - fix(assistant): default the handshake capture group (`match[1] ?? ''`) so the index access stays defined under a consumer's `noUncheckedIndexedAccess`

## 0.5.1

### Patch Changes

- [`b28d167`](https://github.com/briancray/abide/commit/b28d1672a06d93daf7470452379139758854a1db) - pin the serve command to this bundle's version ([`b03d1af`](https://github.com/briancray/abide/commit/b03d1afca3e1a60263ed57fca0dee42a9c4a4b39))

## 0.5.0

### Minor Changes

- [`9cbca7d`](https://github.com/briancray/abide/commit/9cbca7d28c258d4574ac450811628f107e502711) - Bundle apps auto-start the local assistant. When a bundled abide app connects (embedded or remote) and the app ships `@abide/claude-code` (its UI uses `browser/assistant`) with `claude` on PATH, the bundle launcher runs the loopback bridge for you and hands the page its port+token via the URL fragment — no copy-paste command. The bridge is loopback-only and dies with the connection. abide takes **no dependency** on `@abide/claude-code`: it's a guarded optional import that no-ops (and compiles fine) when the app doesn't ship it.

  `assistant()` gains a `status` — `'ready' | 'starting' | 'manual' | 'unavailable'` — so the same UI works in a browser (`manual` → show `command`) and a bundle (`starting`/`ready` auto-managed, or `unavailable` when `claude` isn't installed → show an install hint). `command` is now `string | undefined` (undefined whenever a host manages the bridge).

- [`aca78cc`](https://github.com/briancray/abide/commit/aca78cc726e71a85e37dc654693243893d4627e4) - `serve` and `launch` now drive your installed `claude` binary instead of the bundled SDK, so `bunx @abide/claude-code serve` (and `launch`) need only Bun and `claude` on PATH — the serve bridge has **zero runtime dependencies**. `@anthropic-ai/claude-agent-sdk` is no longer a hard dependency: it's an optional peer, required only by the SDK-backed `engine()` (embedded server-side `agent()` where there's no local `claude`); install it explicitly for that path.

  A new internal `cliEngine` drives `claude -p --output-format stream-json` over the same MCP contract and isolation as the SDK engine, sharing the message→frame mapping. Note: `launch`'s `permissions` option is now `permissionMode`.

### Patch Changes

- [`e9217c9`](https://github.com/briancray/abide/commit/e9217c94e505f7b94fc46143068d3b7a75bf2342) - `serve` ends shortly after the last subscriber disconnects, so `bunx @abide/claude-code serve` doesn't linger once you close the tab. Exposed as `onIdle`/`idleGraceMs` (the bin exits 30s after the page closes; a reload reconnects within the grace and cancels it). Only armed after the first connection, so the bridge waits indefinitely for the page to first appear; programmatic `serve()` callers omit `onIdle` to stay resident.

## 0.4.0

### Minor Changes

- [`c93735a`](https://github.com/briancray/abide/commit/c93735ac8985a1a86036b1c9707994f6fbe96a14) - Add local-assistant surfaces alongside the `agent()` engine, all over the app's MCP surface:

  - `bunx @abide/claude-code` launches the interactive `claude` TUI wired to your local app's MCP (`--url` retargets a deployed app); `bunx @abide/claude-code serve` runs a loopback bridge so a remote site's browser can drive the user's local Claude.
  - `@abide/claude-code/browser/assistant` — reactive `assistant(config)` handle over a loopback WebSocket: `available` is the connection being open (no polling), `ask(messages)` returns a `Subscribable` of accumulating reply snapshots for `subscribe(assistant.ask(messages))` (dedupes by conversation, so the run doesn't re-fire on re-render), and `command` is the copy-paste first-run hint. Capabilities/systemPrompt are page-side _requests_ only; tools/permissions stay user-controlled in `serve` (default `tools: []`). The browser↔bridge channel is WebSocket; Claude→app MCP stays HTTP.
  - `@abide/claude-code/serve` and `@abide/claude-code/launch` exported for programmatic use.
  - The app's MCP server is now registered under its own `serverInfo.name` as `mcp__<appname>__*` (discovered via a pre-flight `initialize`, scope kept and sanitized) instead of the hardcoded `mcp__app__*`, so multi-site sessions no longer collide.
  - The engine now streams text token-by-token (`includePartialMessages`) instead of one frame per completed turn, matching the `@abide/anthropic` engine's live-delta cadence.

### Patch Changes

- Updated dependencies [[`946b6c4`](https://github.com/briancray/abide/commit/946b6c44b09ca30f28f4ab38d43ad5f9db452c2a), [`946b6c4`](https://github.com/briancray/abide/commit/946b6c44b09ca30f28f4ab38d43ad5f9db452c2a)]:
  - abide@0.19.4

## 0.3.0

### Minor Changes

- [`e5f5344`](https://github.com/briancray/abide/commit/e5f5344d17e672fa4dc4b231e755f724cf5c4cc5) - settings-shaped permissions, tool gating, and tool_result frames ([`a00bb92`](https://github.com/briancray/abide/commit/a00bb923b57cadf1e6109e7408f24ebc000a32bb))

## 0.2.1

### Patch Changes

- [`e772716`](https://github.com/briancray/abide/commit/e772716a190f826f0041b8358271604ad5a230a5) - surface abnormal engine stops and bound the tool loops ([`d2c3215`](https://github.com/briancray/abide/commit/d2c3215bb50ba41b2407eb8878e426a164927d9d))

- Updated dependencies [[`e772716`](https://github.com/briancray/abide/commit/e772716a190f826f0041b8358271604ad5a230a5), [`e772716`](https://github.com/briancray/abide/commit/e772716a190f826f0041b8358271604ad5a230a5), [`e772716`](https://github.com/briancray/abide/commit/e772716a190f826f0041b8358271604ad5a230a5)]:
  - abide@0.19.2

## 0.2.0

### Minor Changes

- [`d23c7ec`](https://github.com/briancray/abide/commit/d23c7ec542c180e611dd47c663cfc65319cb23ad) - `engine(config)` now controls Claude Code's posture with a single `permissionMode` option (`'default'` | `'acceptEdits'` | `'plan'` | `'dontAsk'` | `'bypassPermissions'`), replacing the `permission` allow/deny lists; `'bypassPermissions'` is wired with the SDK's required `allowDangerouslySkipPermissions` flag
