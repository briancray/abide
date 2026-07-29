# Domain context

Terms this codebase uses that are not obvious from the code, and not already defined in `CLAUDE.md`
(the public-API reference) or `docs/adr/` (the decisions). Add a term here when a module is named after
a concept rather than a mechanism — the name is then load-bearing and needs one definition.

`CLAUDE.md` defines the **public** vocabulary (`state` / `memo` / `channel`, `rpc = memo + transport`,
`socket = channel + transport`, the probe verbs). This file covers the **internal** concepts that
several modules are organised around.

---

## Adopted ambient

A value the **server resolved** that the browser **adopts and never mints**.

Three of them: `route()`, `identity()`, `trace()`. Each is read ambiently (no prop threading), each is
reactive on the client, and each arrives from outside — the hydration seed, a nav confirm's header, or
a `/__abide/identity` fetch. The browser never invents one: a client-minted value names something no
server agrees with.

The shape is `shared/internal/adoptedAmbient.ts`; each holder supplies two parameters:

- **`isValid`** — how much of the wire shape must be present. A malformed value is **dropped** and the
  previous one stands, because the invariant callers rely on is "a valid value or `undefined`".
- **`changed`** — an optional extra guard over the cell's own identity check, for a value decoded fresh
  each time. `identity` supplies one (a fresh-but-equal principal must not wake readers); `route`
  supplies none (fresh-object-per-nav IS the change signal, which is what republishes a param nav).

On the **server**, `route()`/`identity()`/`trace()` read the request scope instead, and `trace()` alone
also *mints* there — minting is request-scoped by ADR 0026.

## Lane

One of the compiler's outputs for the same `.abide` source. There are three: the **build lane** (a
shared `templatePlan` feeding `emitServer` + `emitClient`) and the **check lane** (`emitCheck`, which
lowers to type-only TS). They keep separate *lowerings* on purpose — a `{#for}` becomes a real TS
`for…of` for the type checker and a keyed reconcile at runtime — but must agree on what is **legal**
(`validateTemplate` asks the build lane's gate) and on what each construct **means**
(`componentAttrLanes.test.ts` enumerates that).

## Surface

A projection of the app's registry for one kind of caller: HTTP, OpenAPI, MCP, CLI, the client bundle,
an agent's tool list. `clients: { browser, mcp, cli }` gates surface **generation** at build time;
`middleware` is authorization at request time. Different mechanism, different time — a surface flag is
never auth.

## Route class

One branch of the router's dispatch — rpc, socket face, page SSR, chunk asset, public file, health,
identity, logs, openapi, mcp. Each needs the same cross-cutting treatment (method gate, CORS,
middleware chain, response exit), which is why those live in one place (`enforceMethod`, `exit()`)
rather than per branch.

## Probe

A reactive read of a slot's *status* rather than its value — `peek` / `pending` / `refreshing` /
`error` / `chunks` / `done`. The vocabulary is one declaration (`ReactiveValueProbes` +
`ReactiveStreamProbes`) that `memo`, `channel`, `socket`, `Rpc` and `StreamRead` all derive from,
parameterized by value type and by arg-tuple. A probe wakes for its **own** axis.

## Command surface

What a compiled binary does when run: the reserved commands (`serve`, `logs`, `connect`, `login`, …)
plus the app's own `clients.cli` rpcs as subcommands. It has two entry points over one table —
`runCompiledApp` (one-shot, argv) and `interactiveCli` (the REPL prompt) — which differ genuinely in
session-ness, ctrl-c handling, and what `serve` means.

Those three differences are **parameters**, not branches. Both entry points dispatch reserved names
through one `reservedCliDispatch`, which is total over `CommandSurfaceReserved` (the `where: 'both'`
names, derived from `RESERVED_CLI_COMMANDS`) and takes the differences as context: a `serve` hook, an
optional `interceptInterrupt`, and the `after*Change` hooks where a session re-resolves and a command
line simply exits. Each surface used to write its own ladder over all ten names, and nine were the same
call twice — so the table could only half-enforce itself (a name a surface *intercepts* must be in the
table; nothing required the table's names to be intercepted), and `completion` sat in that gap: listed
in help, warned about as shadowing an author's rpc, and `unknown command` at the prompt.
