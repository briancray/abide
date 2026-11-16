---
'@abide/abide': minor
---

`assistant` runs in the run of a `global` value — a `GET` declaring `global` that streams one answer to every reader. No request owns that run, so its provider's signal aborts when the app stops (`stopSignal`) or the caller's `signal` does, not when the first reader leaves; it carries no asker's credentials, and asking it for tools (`mcp`) throws. Outside a request elsewhere the same holds, where it used to throw. A conversation run as the native app's window ends when the app stops too. RULEBOOK 44.57, 44.100, 44.101.
