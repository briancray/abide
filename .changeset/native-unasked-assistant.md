---
'@abide/abide': minor
---

In the native app, `assistant` called outside a request — from a timer or `onStart` — runs as the window's latest request: its principal, its caller and its credential, so `provider.claudeCode` runs on the app's own Claude Code and the app's tools answer as the window's person. Outside the native app, or before the window has asked anything, it still throws. RULEBOOK 44.100.
