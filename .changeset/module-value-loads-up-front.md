---
'@abide/abide': patch
---

A module's `reactive` whose body makes a call — `export const me = reactive(() => whoami())` — is now built for each request before the page and its layouts are set up, the way a browser builds it at import. Before, the server built it where the markup first read it, so the call started halfway through the build: regions built inline painted it in flight and a child built after the turn painted it landed, and hydration rebuilt whichever disagreed with the browser (15 `abide:hydrate` warnings on one real page). One page now carries one answer. Only values whose build outside a request left a load in flight are built up front; a value derived from one is still built where it is first read. RULEBOOK 41.34, 11.67.
