---
"@belte/claude-code": minor
---

`serve` and `launch` now drive your installed `claude` binary instead of the bundled SDK, so `bunx @belte/claude-code serve` (and `launch`) need only Bun and `claude` on PATH — the serve bridge has **zero runtime dependencies**. `@anthropic-ai/claude-agent-sdk` is no longer a hard dependency: it's an optional peer, required only by the SDK-backed `engine()` (embedded server-side `agent()` where there's no local `claude`); install it explicitly for that path.

A new internal `cliEngine` drives `claude -p --output-format stream-json` over the same MCP contract and isolation as the SDK engine, sharing the message→frame mapping. Note: `launch`'s `permissions` option is now `permissionMode`.
