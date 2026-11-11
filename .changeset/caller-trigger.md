---
'@abide/abide': minor
---

`rpc.refresh(pattern, { caller })` and `rpc.invalidate(pattern, { caller })`: on the server, a trigger
narrowed to the one browser whose `principal.caller` it names — sent to that browser's follows over the
mux and no other's, while the server's own values are triggered as without it. In a browser, which
cannot tell whose caller it is, passing one throws. A streaming `GET` is now read over the socket mux,
holding no http connection while it streams. RULEBOOK 16.93-16.96, 18.37, 18.38.
