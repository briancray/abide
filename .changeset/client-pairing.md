---
'@abide/abide': minor
---

`pairing()` from `@abide/abide`: this browser's Claude Code pairing in a page — `status` (the latest
`BridgeStatus`), `step` (`'click' | 'waiting' | 'install'`) and `copied`, with `start()` to pair with a
click on the `abide-bridge:` link and `copyInstall()` to copy the install command. It reads the new
built-in `/__abide/pairing`, which abide mounts off every generated surface and exempt from
`ABIDE_RPC_TIMEOUT`, so an app drops its own `bridge.handler.ts` and the pairing code it copied.
Pass `pairing({ tools })` to grant tools, as with `claudeCode.bridge({ tools })`. RULEBOOK 44.67-44.74.
