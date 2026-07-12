---
"@abide/abide": minor
---

add `abide/shared/invalidate` and broadcast both staleness verbs across clients (ADR-0041).

`invalidate(selector?, args?)` is reintroduced as the distinct DROP verb (next read reloads lazily; a mounted retained reader revalidates stale-in-place), paired with the existing `refresh` REFETCH verb. Instance sugar `fn.invalidate(args?)` sits beside `fn.refresh(args?)`.

Both verbs are now isomorphic: applied locally on the client, and on the SERVER they broadcast to every connected client over a reserved, server-publish-only `__abide/cache` socket (live-only, no replay — an offline client falls back to SWR staleness). **`refresh`'s server behaviour changed** from a local throwaway refetch that reached zero browsers to a cross-client broadcast — a semantic change to an existing public verb. Producer/closure and bare match-all selectors are not cross-client serializable and are rejected when broadcast from the server. The `__abide/*` socket namespace is now reserved (a user socket file may not declare it).
