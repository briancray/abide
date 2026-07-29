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

The whole ambient is `shared/internal/adoptedAmbient.ts` — including the READ LADDER: **the request
scope's answer, else the adopted one, else this ambient's policy for "nobody has said"**. Each of the
three (`routeAmbient` / `identityAmbient` / `traceAmbient`) is that shape with four parameters, and
`shared/{route,identity,trace}.ts` are the public naming seams over them, nothing more.

- **`isValid`** — how much of the wire shape must be present. A malformed value is **dropped** and the
  previous one stands, because the invariant callers rely on is "a valid value or `undefined`".
- **`changed`** — an optional extra guard over the cell's own identity check, for a value decoded fresh
  each time. `identity` supplies one (a fresh-but-equal principal must not wake readers); `route`
  supplies none (fresh-object-per-nav IS the change signal, which is what republishes a param nav).
- **`fromScope`** — the server rung. Two of the three read a field; `trace()` alone also *mints* there,
  which is request-scoped by ADR 0026 and is why this is a callback rather than a key.
- **`absent`** — where the three legitimately part company: `route` throws, `identity` returns a frozen
  anonymous floor in the browser and throws on the server (so a `crossRequest` memo body fails closed),
  `trace` answers `undefined`. Its return type flows out through `read()`, so an ambient that throws
  reads as `T` and one that does not reads as `T | undefined`.

`read()` is the ladder; `adopted()` is the middle rung alone, for the one caller that asks whether
anything has been adopted rather than what the answer is.

## Lane

One of the compiler's outputs for the same `.abide` source. There are three: the **build lane** (a
shared `templatePlan` feeding `emitServer` + `emitClient`) and the **check lane** (`emitCheck`, which
lowers to type-only TS). They keep separate *lowerings* on purpose — a `{#for}` becomes a real TS
`for…of` for the type checker and a keyed reconcile at runtime — but must agree on what is **legal**
(`validateTemplate` asks the build lane's gate) and on what each construct **means**
(`componentAttrLanes.test.ts` enumerates that).

## Chain rung

Which layer of middleware a unit of work owes. There are two, and conflating them is the design error the
`rpcChain.ts` module exists to prevent.

- **An rpc's OWN `middleware` is per READ.** `Middleware` is `(next) => Response` — tracing, rate limiting,
  context population, response post-processing, auth — so it is part of what a read MEANS, and a read that
  skips it is not merely unauthorized, it is unobserved. It therefore runs from every door of a BUILT app:
  HTTP, page SSR, a handler reading a sibling rpc, a cron tick.
- **The app's global `config.middleware` is per REQUEST.** It runs once for the unit of work, and a read
  inside a request does not re-run it. Otherwise a page with eight reads counts nine hits in a rate limiter
  and logs nine lines for one request. `owesGlobalChain()` (`currentScope() === undefined`) is the
  discriminator; it is the rule a WS subscribe already followed, since a socket join is inside no request.

Two invariants hold this together and each has a test that fails on it:

- **The chain wraps the CALL, never the memo body.** A memo coalesces by ARGS, not by identity, so a chain
  inside the body would let the first caller's authorization stand in for the next caller's.
- **Exactly once per read.** The router composes the chain around the whole of dispatch — so arg decoding
  and `schemas.input` validation happen INSIDE authorization, and a 422 never precedes a 403 — and then
  invokes `route.bare(args)`, the same producer minus the chain. `bare` is handed in by each factory rather
  than rebuilt from the memo, because a mutation's producer is not "call the memo": a `FormData` body and
  `memo: false` both bypass it, and rebuilding that branch routed every multipart upload through the memo.

Two limits of the current implementation, recorded because "from every door" reads as unconditional and is
not, and both are one grep from being checked:

- **The chain is installed by `createApp`**, so a door that builds no app has none. `abide run` boots
  through `appLifecycle` with `boot: () => undefined` and never calls `createApp` (`cli/run.ts`), and
  `bootApp` calls it INSIDE the `start()` thunk — so a migration, and an `onStart` warmer reading before
  `await start()`, run NEITHER rung. `cli-lifecycle.md` CL2 says the middleware chain does not run under
  `run`, which was written when there was only the per-request rung; whether the per-READ rung should
  reach a migration is open. Until it is answered, a migration authorizes itself.
- **`throughChain` installs no scope**, so the middleware's ambients answer from the CALLER's scope: at
  page SSR `route().kind` is `'nav'`, so a guard keyed on `route().name === '<rpc>'` does not fire, and
  from a scope-free door `route()`/`identity()`/`request()` throw. `channelAuth` is the one door that
  synthesizes an rpc-shaped scope (`runInScope` over a synthetic request) — the asymmetry is real and
  unasserted.

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

**It is now a declared pair** (`server/internal/routeClass.ts`): the methods a class SERVES, and how it
answers. `dispatch` resolves one, gates the method, calls it — so the method gate is STRUCTURAL rather
than a line each branch remembers. That completes an arc `enforceMethod`'s own header started: the gate
got one owner, but *calling* it stayed per-branch, six of the call sites were the identical
`enforceMethod(scope.request, ['GET'])` inline in one function, and the tenth class (page SSR) had already
been added without one. `RouteClass.methods` being required means there is nowhere to not mention it.

Two classes return `GATE_IN_HANDLER` instead of a list, and the reason is not laziness: the socket HTTP
face and an unregistered rpc must answer **404 before 405**, because a 405 for a name that does not exist
is wrong and its `Allow` would suggest the name might be real. `routeClass.test.ts` pins that with a verb
outside each class's own set — the first draft used `PUT`, which `allowedMethodsFor(undefined)` admits, so
it passed and went on passing with the opt-out deleted.

Resolution stays an ordered LADDER, split in two (`resolveFrameworkClass` / `resolveAppClass`) at the
public-file rung — the one place the precedence has a reason rather than an order: a file in
`src/ui/public/**` is checked after everything the framework owns and before everything the app owns. It is
not a class, because its match is an async lookup that can miss and a miss must fall through.

The three fat branches became modules (`chunkAsset.ts`, `navRoute.ts`, `rpcRoute.ts`), which took
`router.ts` from 1296 lines to 855.

## Probe

A reactive read of a slot's *status* rather than its value — `peek` / `pending` / `refreshing` /
`error` / `chunks` / `done`. The vocabulary is one declaration (`ReactiveValueProbes` +
`ReactiveStreamProbes`) that `memo`, `channel`, `socket`, `Rpc` and `StreamRead` all derive from,
parameterized by value type and by arg-tuple. A probe wakes for its **own** axis.

## Command surface

What a compiled binary does when run: the reserved commands (`serve`, `logs`, `connect`, `login`, …)
plus the app's own `clients.cli` rpcs as subcommands.

**It lives in `src/server/command/`.** It used to be 30 files spread through `src/server/internal/` —
a third of that directory — with terminal line editing (`lineReader`, `columnise`, `tokenizeCliLine`)
sitting beside the HTTP router and the identity cookie ladder, and nothing saying which third was which.
The set is a CLOSED SUBGRAPH: every one of those modules was imported only by another of them, with
exactly two edges crossing in — `cli/main.ts` for `CLI_EXIT_CODES`, and the import string
`stageCompileEntry` GENERATES into a compiled binary's entry. It had every property of a module except a
name.

It is under `server/`, not a sibling of it, because that is load-bearing rather than tidy: the package
exports `"./server/*"` and nothing for `cli/`, so `abide/server/command/runCompiledApp` is the only way a
compiled binary can reach its own entry point (the `*` in a subpath pattern matches across `/`).

**The direction is one-way and asserted** (`commandSurfaceFloor.test.ts`): `server/internal/` imports
nothing from `server/command/`. That is what made the relocation provably inert for the router, and it is
the edge worth guarding — wiring a reserved command into a route reads as reuse and would put the terminal
line reader, the REPL and the `0600` credential file on the HTTP request path. The converse is *correct*
and deliberately unasserted: `command/` reaches `internal/router.ts` because `serve` hosts the real app,
and `internal/clientBundle.ts` type-only for the `ClientBuild` shape.

What the directory does NOT yet buy is a clean dependency FLOOR for the binary. Three modules still point
back at `cli/` (`serve.ts`, `parsePort.ts`, `installShutdownHandlers.ts`), and `cli/serve.ts` pulls
`clientBundle.ts` — the module that calls `Bun.build` — into the compiled graph. So `cli/` is not purely
the dev-time half; those three are shared and belong on this side. Recorded rather than fixed: it is a
further move, and the 16 KB figure in `CLAUDE.md` says the cost is currently tolerable.

It has two entry points over one table —
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
