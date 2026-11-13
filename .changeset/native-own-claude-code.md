---
'@abide/abide': minor
'@abide/bridge': minor
---

A native app built with `abide bundle` now pairs its window with Claude Code on the same machine. Nothing needs to be installed, no link needs clicking and no code is spent (RULEBOOK 44.77). `provider.claudeCode` runs turns there, inside the app's process, and pages see an ordinary paired `BridgeStatus`. The window's turns get every tool the site asks for, both built-in tools and MCP tools whose server is in the visitor's Claude Code user scope. `missing` lists only MCP tools whose server it doesn't find (RULEBOOK 44.78). Only the window counts as local. It proves this with a cookie minted at each launch, never by its user agent (RULEBOOK 44.79).

The native app runs with the `PATH` the visitor's login shell sets, so it finds `claude` even when opened from the Finder (RULEBOOK 44.80). The window and the menu bar extra's panel now hand links of other schemes, such as `abide-bridge:` and `mailto:`, to macOS instead of failing them (RULEBOOK 38.174).

`@abide/abide` now depends on `@abide/bridge`. The bridge's turn handling is now one module, `@abide/bridge/serveTurns`, shared by `abide-bridge` and the native app.
