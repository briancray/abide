# ADR-0004: Tail is the read, history is dead

**Status:** accepted (2026-06-09)

## Context

The stream-reading surface used three vocabularies for one concept: the
reactive consumer was `subscribe()`, the raw bounded read was `socket.tail(n)`,
the CLI/MCP ops were `<base>-tail`, and the retention buffer was declared
`{ history: n }`. Meanwhile bare socket iteration full-replayed an unbounded
buffer as the *default* — surprising for a consumer joining a chatty topic,
and wasted work for `subscribe()`, which is latest-wins and only ever needed
the newest frame.

"History" was never a property of the socket's live stream. The declared
buffer exists for exactly one purpose — readers who weren't there (late
joiners, reconnect gaps, the fresh-consumer CLI/MCP/SSE faces) — and every
consumer of it was already named tail. Pure consumer-side storage was
considered and rejected: a consumer can only keep what it received, so it has
nothing to offer the reader whose defining problem is that it wasn't there
(and demand-driven retention is empty exactly when the first late joiner
needs it, with no declared cap bounding server memory).

## Decision

One concept, one word, three altitudes — and retention is opt-in:

- `socket<T>({ tail: n })` declares retention: the topic keeps its last `n`
  frames. Omitted = pure live pipe; storage is the consumer's concern.
- Bare iteration is the live stream. Replay is exclusively `.tail`'s job:
  `chat.tail(count)` seeds with the last `count` retained frames, no-arg =
  the whole retained tail. The ws wire is unchanged (`replay` omitted = full,
  number = trailing-n, `0` = live-only); only the local defaults flipped.
- `tail(x)` (was `subscribe()`, now `belte/browser/tail`) is the reactive
  latest-wins read; `tail(x, { last: n })` returns a live `T[]` window of the
  last ≤n frames, however they arrived. `last` is the read-side word (what
  the reader keeps), `tail` the declaration-side word (what the topic
  retains); `last` clamps to the declared `tail`. `last` is registry-keyed
  (`name#last`), so the bare form and each window size are independent
  subscriptions; `tail.status`/`tail.error` take the same options to address
  the same entry.
- Seeding rides an optional `Subscribable.tail(count)` capability rather than
  consumer feature-sniffing for Socket: sockets implement it verbatim,
  one-shot rpc streams omit it and bare-iterate. The consumer bounds replay
  to what the reader keeps (1 for latest-wins, `last` for a window) — a
  pure transfer optimization; final state is identical without it.
- On reconnect the reopened source's frames *replace* a retained window
  (append would duplicate replayed frames); `latest` converges as before.

The window form works identically on retaining and non-retaining sources —
only how much past it can show differs. `cache()` keeps its name: `tail`
earned the unix word by literally being `tail -f`/`-n`; there is no unix word
for keyed memoization, and accuracy beats register consistency.

## Consequences

- Breaking: `belte/browser/subscribe` → `belte/browser/tail` (with
  `.status`/`.error`); socket option `history` → `tail`; bare socket
  iteration no longer replays (use `.tail()` for the old behavior); the
  reactive bare form seeds via `tail(1)` instead of full replay, so retained
  frames no longer churn through `latest` on open.
- A topic that wants late joiners to see the past must declare `{ tail: n }`;
  undeclared topics give CLI/MCP/SSE reads nothing but live frames.
- A future source that retains frames implements `Subscribable.tail(count)`
  and gets bounded seeding for free; the consumer never learns its type.
