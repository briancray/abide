---
"@abide/abide": minor
---

`assistant`'s `mcp` option is `tools`, naming what it does — the model is handed the app's tools — rather than the surface they are read from: `assistant(messages, provider, { mcp: true })` → `{ tools: true }`. `provider.claudeCode.bridgeCommand()` is removed: `provider.claudeCode.bridge()` already yields the command, the link and the install, so its first status is the one-off — `for await (const status of provider.claudeCode.bridge(options)) return status` (RULEBOOK 44.6, 44.8, 44.14)
