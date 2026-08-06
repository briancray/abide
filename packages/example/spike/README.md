# spike: the transport seam

Scratch. Not framework code — it exists to settle the one decision that would force a redesign if
guessed wrong: **how a handler declared once is addressed from the browser without its body going
there.** `bun test packages/example/spike/spike.test.ts` is the proof; `bun packages/example/spike/wire.ts`
runs both laws end to end.

Delete the directory or promote its pieces. Nothing else imports it.

## What it beats

`vanilla.ts` is the hand-written form: 20 lines, no cache, and the call declared **three** times —
handler, route, client stub — with nothing checking that the three agree. The line count is not the
argument; the third declaration is. Adding what `memo` already does (coalesce concurrent readers,
retain across a reload, tell `pending` from `refreshing`, drop a stale settle) is ~40 more lines of
it, by hand, per endpoint.

## The four decisions

**1. The lane is read off `build.config`.** The bundler populates it — `target: "browser"` for both
`Bun.build` and the dev server's HTML routes (verified against a live `bun run web`) — and the
runtime `plugin()` registration leaves it `undefined`. It is the only discriminator available, so it
is asserted rather than trusted: a wrong answer here ships a database driver to a browser, silently.

**2. The directory is the kind.** `server/rpc/**` is rpc, `server/sockets/**` is a socket. A Bun
plugin filter is a *path* regex, so a `'use server'` directive would mean intercepting every `.ts` in
the graph and taking responsibility for loading all of them. A path costs one regex — and unlike the
filename suffix this replaced, it tells the plugin which stub to write *before* it reads the file,
and it gives a misplaced declaration something to disagree with: a `socket` under `server/rpc/` is an
error naming the file, the export and both. With a suffix there was nothing to be wrong about.

**3. An endpoint is recognised syntactically** — `export const NAME = GET(…)` under `rpc`,
`export const NAME = socket(…)` under `sockets`, scanned with the compiler's existing `Lexer`. This
is the rule `.abide` already lives by, for the same reason: the emit path must not need a
type-checker, because the browser lane produces the stub from a file it is about to throw away. Any
other export is a **compile error naming the export** — the alternative is a stub exporting
`undefined` for a helper somebody imported, which fails in a browser, at a call site, with no
mention of the file that dropped it.

**4. Everything abide serves is under `/__abide/`, and the module's own path is the rest of it.**

| file | export | served at |
| --- | --- | --- |
| `server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` |
| `server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |
| `server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

One reserved prefix means an app author needs exactly one rule to know what is theirs and an operator
needs exactly one pattern to proxy, cache, CSP or exclude; `dispatch` returns `undefined` for
anything outside it, so an app mounts it in front of its own routes and never thinks about it again.
The kind stays in the path even though the rest is already unique, because a socket is a websocket
upgrade rather than a POST — the two are genuinely different routes — and because a network panel
showing `/__abide/rpc/admin/audit/recent` says what happened without anyone decoding it.

**There is no hash.** An earlier pass hashed the repo-relative path, because a `*.server.ts` could
live anywhere and two of them could share a name. Mandating the directory removed the ambiguity the
hash existed to resolve, and the filesystem already forbids two files at one path — so the hash was
machinery without a reason, and an address that is legible in a stack trace is worth more than the
bytes it saved.

## What the proof shows

| | |
| --- | --- |
| browser bundle | carries both addresses; carries **neither** `findUser` nor `db.ts`'s marker. `db.ts` has a module-level side effect, so its absence is elision, not tree-shaking |
| server lane | the runtime plugin intercepts `.ts` and appends registration — every endpoint registers with **no** filesystem scan and no manual wiring |
| both lanes | compute the same address from the same source |
| the app's routes | a request outside `/__abide/` comes back untouched |
| rpc | `peek` / `pending` / `await` / `settled` behave as they already do; a 404 throws from the read |
| socket | published on the server into a plain `channel()`, read on the client off the client's own channel surface — `peek()` and `chunks()` filled by the wire alone |
| **coalescing** | three concurrent readers of one key cost **one** request. Nothing in the transport does that — the slot does, exactly as it already did for a local load |

That last row is the whole case for `rpc = memo + transport`. The socket row is the same case for
`socket = channel + transport`: the server half of a socket is `channel()` *unchanged*, and the
entire transport is one `subscribe` on upgrade and one unsubscribe on close.

## What it found that changes the plan

**The transport suites cannot share a `bun test` lane with the UI suites.** `bunfig.toml` preloads
happy-dom for every test file, and happy-dom replaces `Response` and `URL` with its own — which
`Bun.serve` cannot serialise — and its `fetch` preflights every cross-origin call and then rejects
the 204 it gets back. A transport is not exercisable in that lane at all. `wire.ts` is therefore a
separate process that `spike.test.ts` spawns. Before rpc demos are written, decide whether that is a
second bunfig, a spawn helper in `$tests`, or an `unregister()` around the suite — because
"a demo IS the test" has to keep holding.

**A mount point needs a preflight answer** before anything cross-origin works. `dispatch` answers
`OPTIONS` and pins rpc to POST. That is `opts.crossOrigin` in the spec, open here because there is no
option yet; the spec closes it by default, which is policy on top of this shape, not a different one.

## Still open — for the transports themselves, not for the seam

- **Options do not cross.** `GET(fn, { ttl, tags, middleware })` is server-side text; the stub can't
  copy it, because an option may reference a server-only import (`middleware: [auth]`). Client cache
  policy has to arrive some other way — response headers, or a declared client-side subset. This does
  not change the seam, and it is the first thing rpc must settle.
- **A stray `GET()` outside a transport directory is silently local.** The plugin only sees files its
  filter matches, so catching one means a whole-tree pass — which is what `abide check` already is.
- **Serialization is `JSON.stringify`.** Named errors surviving the wire (`fn.isError`) is unbuilt.
- **`_method` is unused** by `remote`; GET vs POST has to change caching, since a mutation retains
  nothing.
- **The socket is receive-only** — `clientPublish` is a policy decision (may a client publish, and
  what happens to what it sends), not plumbing. No reconnect either; the spec promises one.
- **No per-request scope**, so the server's memo cache is still process-global — the gap that must
  close before any of this is safe to serve. Independent of the seam.
