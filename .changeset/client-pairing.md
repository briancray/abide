---
'@abide/abide': minor
---

`pairing()` from `@abide/abide`: this browser's Claude Code pairing in a page — `status` (the latest
`BridgeStatus`), `step` (`'click' | 'waiting' | 'install'`) and `copied`, with `start()` to pair with a
click on the `abide-bridge:` link and `copyInstall()` to copy the install command. It reads the new
built-in `/__abide/pairing`, which abide mounts off every generated surface and the page follows
over the socket mux it already holds — no connection is held while it watches — so an app drops its
own `bridge.handler.ts` and the pairing code it copied.
The tools a pairing grants are the server's to decide: set `ABIDE_BRIDGE_TOOLS` (comma-separated, an
`onConfig` default or the environment); unset grants none, and a request naming tools is ignored.
RULEBOOK 44.67-44.75.
