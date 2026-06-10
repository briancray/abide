---
"@belte/belte": minor
---

Registries act, probes report: standalone `pending`/`refreshing` spanning cache and streams, the `ttl: 0` mutation idiom made sound, and tail reconnect-with-retained-value.

**Breaking**

- `cache.pending` / `cache.refreshing` moved to their own modules: `import { pending } from '@belte/belte/shared/pending'`, `import { refreshing } from '@belte/belte/shared/refreshing'`. `cache.invalidate` stays on `cache`.
- SSR snapshots ship GET entries only (`REPLAYABLE_METHODS`): DELETE is idempotent but still a write and no longer replays from hydration.
- `cache()` now throws at wrap time on invalid policy combinations: `invalidate` policy on a non-GET remote, policy with `ttl: 0`, or `throttle` and `debounce` together.

**Fixed**

- Invalidate policies attach on read to entries that lack one (like scope tags), so a snapshot-hydrated entry revalidates stale-in-place from its first invalidate instead of hard-dropping to a pending flash, and a policy-less first read no longer permanently wins.
- Hydrated snapshot entries adopt the first reading call site's `ttl` (the snapshot ships no wrap options): omitted keeps the entry as before, `ttl > 0` starts the expiry clock at that read, and `ttl: 0` serves the hydration pass only, evicting a macrotask later — previously any ttl was ignored, so a `ttl: 0` key warm-hit forever and never refetched.
- Eviction clears armed policy timers — a TTL-expired or rejected key can no longer ghost-refetch.

**Added**

- `pending(x)` / `refreshing(x)` probe both registries: cache selectors (bare / fn / `{ scope }`) plus Subscribables — `pending(chat)` is "awaiting first frame", `refreshing(chat)` is "reconnecting with last value retained" (never merely open). Bare forms span registries. Probes report, never act: they open no fetch and no stream.
- `tail()` (né `subscribe()` — renamed in this release) self-heals transport loss: on the typed `SocketDisconnectedError` it keeps its value, flags `refreshing`, and reopens under the channel's backoff (retained-tail replay converges the value — correct for a latest-wins/window consumer). Server `err` frames stay terminal; raw `for await` consumers keep the explicit-disconnect contract.
- `cache()` warns once per call site when handed an anonymous producer (fresh identity per call — it can never coalesce and probes can never match it).
