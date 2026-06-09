# @belte/claude-code

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
