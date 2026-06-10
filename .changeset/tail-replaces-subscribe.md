---
"@belte/belte": minor
---

`subscribe()` is now `tail()`, and "history" is dead: one word for reading the retained end of a stream at every altitude — declaration (`socket<T>({ tail: n })`), raw iteration (`chat.tail(count)`), and the reactive consumer (`tail(x)` / `tail(x, { last: n })`).

**Breaking**

- `import { subscribe } from '@belte/belte/browser/subscribe'` → `import { tail } from '@belte/belte/browser/tail'`; `subscribe.status`/`subscribe.error` → `tail.status`/`tail.error` (both accept the same `{ last }` options to address a window entry).
- Socket declaration option `history` → `tail` (`socket<T>({ tail: 100 })`). Retention is opt-in: an undeclared socket is a pure live pipe and storage is the consumer's concern.
- Bare socket iteration (`for await (const m of chat)`) is now live-only — replay is exclusively `.tail`'s job. `chat.tail()` no-arg replays the whole retained tail (the old bare behavior); `chat.tail(n)` the last n. The ws wire is unchanged; only the local defaults flipped.
- The reactive bare form seeds a socket via `tail(1)` instead of full replay — retained frames no longer churn through `latest` on open.

**Added**

- `tail(x, { last: n })` → `T[]`: a live rolling window of the last ≤n frames, however they arrived ([] while pending and on SSR, never undefined). Retaining sockets seed it by replaying up to `last` (clamped to the declared `tail`); rpc streams and undeclared sockets fill it from live frames. The bare form and each window size are independent subscriptions (`last` is registry-keyed). On reconnect the replay replaces the window, so a gap can't duplicate frames.
- `Subscribable.tail(count)` is the optional retention capability: sources that keep recent frames implement it (sockets do verbatim) and the consumer bounds replay to what the reader keeps — no consumer special-casing per source type.

**Fixed**

- An untracked `tail.status()`/`tail.error()` read (outside `$derived`/`$effect`) no longer leaks a permanently-pending registry entry that held the bare `pending()` probe true forever.
