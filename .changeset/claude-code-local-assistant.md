---
"@belte/claude-code": minor
---

Add local-assistant surfaces alongside the `agent()` engine, all over the app's MCP surface:

- `bunx @belte/claude-code` launches the interactive `claude` TUI wired to your local app's MCP (`--url` retargets a deployed app); `bunx @belte/claude-code serve` runs a loopback bridge so a remote site's browser can drive the user's local Claude.
- `@belte/claude-code/browser/assistant` — reactive `assistant(config)` handle over a loopback WebSocket: `available` is the connection being open (no polling), `ask(messages)` returns a `Subscribable` of accumulating reply snapshots for `subscribe(assistant.ask(messages))` (dedupes by conversation, so the run doesn't re-fire on re-render), and `command` is the copy-paste first-run hint. Capabilities/systemPrompt are page-side *requests* only; tools/permissions stay user-controlled in `serve` (default `tools: []`). The browser↔bridge channel is WebSocket; Claude→app MCP stays HTTP.
- `@belte/claude-code/serve` and `@belte/claude-code/launch` exported for programmatic use.
- The app's MCP server is now registered under its own `serverInfo.name` as `mcp__<appname>__*` (discovered via a pre-flight `initialize`, scope kept and sanitized) instead of the hardcoded `mcp__app__*`, so multi-site sessions no longer collide.
- The engine now streams text token-by-token (`includePartialMessages`) instead of one frame per completed turn, matching the `@belte/anthropic` engine's live-delta cadence.
