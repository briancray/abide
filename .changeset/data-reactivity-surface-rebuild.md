---
"@abide/abide": minor
---

Rebuild the data & reactivity surface around one smart call plus thin modifiers/probes/reactions.

**Breaking changes:**

- The **bare rpc call is now the smart read** — cached, coalesced, reactive, and stale-while-revalidate by default for replayable (GET/HEAD) reads; writes are coalesce-only. `cache(getFoo, args)` → `getFoo(args)`. The `cache()` function and the `./shared/cache` export are removed (the store remains the internal substrate). Per-call transport options (`signal`/`headers`/`keepalive`/`priority`/`cache`) move to `getFoo.raw(args, init)`; the smart call's second arg is cache/stream options (`ttl`/`tags`/`throttle`/`debounce`/`n`).
- **`.refresh` / `.patch` / `.peek`** — new global functions (`./shared/refresh`, `./shared/patch`, `./shared/peek`) and rpc instance methods. `.refresh` replaces `.invalidate` (refetch keeping the stale value visible, never blanking); `.patch` mutates the retained value locally with no network; `.peek` reads the retained value synchronously. `fn.invalidate`/`fn.cache` instance methods are removed (`fn.refresh` / the bare call replace them).
- **`watch(source, handler)`** (`./ui/watch`) is the single reaction primitive, replacing `effect`, `socket.on`, and `cache.on` for authors and the compiler (bindings emit `$$watch`). `effect` is off the taught surface (internal plumbing).
- **Sockets:** `socket.broadcast(msg)` replaces `.publish`; retention (`tail`) defaults to `1`; `socket.peek()` / `socket.refresh()` added. The `tail()` reactive-consumer function (`./ui/tail`) and `socket.tail()` are off the taught surface — consume the socket directly (`for await` / `watch`) and window via `watch` + `state`; `pending`/`refreshing`/`done`(socket) now register on consumption.
