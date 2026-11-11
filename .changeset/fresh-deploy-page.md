---
'@abide/abide': patch
---

A page and a public file served with `ABIDE_OFFLINE` on are asked of the network on every load
(`max-age=0, stale-if-error=31536000`) rather than answered stale while it is asked behind — the visit
after a deploy opens the new build, where it opened the last one's markup over a stylesheet the new
one no longer serves and painted unstyled until a reload. The kept copy still stands in offline.
Handler answers keep `stale-while-revalidate`. RULEBOOK 21.22, 21.23, 21.25.
