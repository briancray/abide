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
- **The app's global `config.middleware` is per REQUEST.** It runs wherever a REQUEST exists to authorize —
  the router at mount, and the WS `@rpc:` join, which synthesizes a request-shaped scope precisely so it can
  run it — and nowhere else. So a page with eight reads runs it once, not nine times, and a scope-free read
  runs the own rung alone. Selecting it by `currentScope() === undefined` ("nothing has run it, so run it")
  conflates that with a different question and was a landmine: the global chain is where an app reaches for
  `request()`, so a cron tick's read threw inside the middleware meant to observe it, and a chain that does
  not reach its terminal fails closed.

Four invariants hold this together and each has a test that fails on it:

- **The chain wraps the CALL, never the memo body.** A memo coalesces by ARGS, not by identity, so a chain
  inside the body would let the first caller's authorization stand in for the next caller's.
- **Exactly once per read.** The router composes the chain around the whole of dispatch — so arg decoding
  and `schemas.input` validation happen INSIDE authorization, and a 422 never precedes a 403 — and then
  invokes `route.__bare(args)`, the same producer minus the chain. `__bare` is handed in by each factory
  rather than rebuilt from the memo, because a mutation's producer is not "call the memo": a `FormData` body
  and `memo: false` both bypass it, and rebuilding that branch routed every multipart upload through the memo.
- **`route()` inside the chain names the READ, not the caller.** Otherwise the documented guard idiom
  (`route().name === '<rpc>'`) silently never fires on the SSR door, where the active scope is the nav's —
  which is worse than not running the middleware, because it looks like coverage. It is a scope copy sharing
  the caller's `slots` Map, so `request()`/`cookies()`/`identity()` still answer the caller's request; and it
  is a SCOPE rather than an assignment because concurrent reads on one request would clobber a field.
- **One installer, every boot.** `bindRpcChains` is called by `createApp`, by `abide dev`'s rebuild and by
  `abide run`, because which door built the app must not decide whether a read is authorized.

## Derived-from-the-registry

State the router computes from `config` at boot rather than per request: the per-route CORS policy, the
composed middleware chain, the per-read chain on each callable, the `(rpc,args)` broadcast sink. Cheap and
correct for a served app, and a trap for `abide dev`, which reloads by REASSIGNING `config.routes` on a live
router. Dispatch reads the registry live, so the premise "reassigning is picked up" held for handlers and
silently failed for all four derivations — an identity-keyed policy Map missed every fresh callable, so from
the first file save onwards a per-rpc `middleware` and a declared `crossOrigin` stopped applying.

So the router's own derivations live in ONE function behind `App.rebind()`, which the rebuild calls, and
the policy is keyed by NAME rather than by route object.

**That rule was PROSE, and it did not hold.** It said "anything derived from the registry is named in that
function"; two derivations were not, and had no invalidation at all — `navRoute`'s `PAGE_PATTERNS` (a
WeakMap keyed on the `AppConfig` OBJECT, while the rebuild reassigns `config.pages` on that same object, so
a page added under `abide dev` was never matched and a deleted one still was) and `defaultAgentSurface`'s
memo (so `agent()`'s tool list kept the first build's `doc`, schemas and `clients.mcp` gate). A third, the
client bundle, was correct only by CONVENTION: a second exported hook the dev loop remembered to call.

So invalidation is now **registered, not remembered** (`server/internal/registryDerivation.ts`). A
derivation names itself at module load, next to the cache it owns; `rebind()` runs the set. Two properties
are load-bearing and each cost a bug to learn:

- **Boot is not a rebind.** The registrations run only on re-bind, never on the initial one. `abide start`
  and `createTestApp` build the client BEFORE constructing the app, so evicting at boot discarded the build
  they had just paid for and served 404 for its chunks. "Derived state is stale" is a claim about a SECOND
  derivation.
- **An invalidator must be a no-op for a config it holds nothing for.** Several apps share a process, so an
  unscoped invalidation lets any app's rebind drop another's — invisible in production, where one app
  rebinds once, and a cross-file flake in a parallel suite.

The rule to keep is now smaller, because the structure carries the rest: a config-keyed cache registers, or
`registryDerivation.test.ts`'s count tripwire fails.

## Surface

A projection of the app's registry for one kind of caller: HTTP, OpenAPI, MCP, CLI, the client bundle,
an agent's tool list, a tag channel's join gate. `clients: { browser, mcp, cli }` gates surface
**generation** at build time; `middleware` is authorization at request time. Different mechanism,
different time — a surface flag is never auth.

**The gate and the loop have an owner** (`server/internal/surfaceProjection.ts`): `reaches`, `rpcsFor`,
`socketsFor`. `registry.ts` owns the NORMALISATION of the authored option and used to stop there, leaving
nine independent `clients.X === false` checks across six modules. Two of those had to AGREE — `mcp.ts`'s
tool LIST and tool DISPATCH must admit the same set, or the surface either advertises a tool that answers
"unknown tool" or, in the direction that matters, leaves a withheld rpc reachable that was never
advertised. Nothing tied the two loops together.

Two things stay per-surface on purpose, and the module says why rather than hiding it:

- **The shape each surface renders.** A read's args become query parameters in OpenAPI, `--flags` on the
  CLI, a JSON Schema for a model. Folding those together would be a worse module than the nine checks.
- **The absent-input-schema fallback**, which has four answers. Three are PROTOCOL REQUIREMENTS (MCP
  demands an object schema; an agent reads an omitted schema as "no declared shape", where `{}` declares
  "takes no arguments"; a spec must describe every parameter) and only the fourth — the CLI's
  `schemaKnown: false`, a parser mode — is a choice. They are NAMED rather than unified, because a single
  answer would be wrong on at least two surfaces.

The same predicate, different CONSEQUENCE, is fine and is now visible: `clientBundle` throws a build error
where every other surface skips, because a page named the callable and skipping would ship an import that
silently resolves to nothing.

The lesson from the guard is worth more than the refactor: the first drift test compared the advertised
list against `rpcsFor` and passed with a raw `registry.rpcs` dispatch loop reapplied — it only proved the
LIST calls the helper. A test for "two projections agree" has to exercise BOTH, not one of them against
the thing they are supposed to share.

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

**The binary also has a dependency FLOOR** (`compiledAppFloor.test.ts`), which is the other axis: the
directory test above says nothing on the HTTP path may import `command/`; this one says nothing
source-reading may be reachable FROM it. `serveCompiled` used to enter through `cli/serve.ts`, whose five
dev branches `ServeOptions` already describes as an interface the module graph could not follow — so the
compiled entry carried `scanAppSources`, `deriveSchemas`, `writeHealthCompanion`, `startWatch`,
`findOpenPort` and the dev-reload browser snippet. Size was the lesser problem: those are reachable paths
that CANNOT WORK on a deploy machine (read-only `/$bunfs/root`, no `src/`, no source). `hostApp.ts` is the
half of serving with none of it, and `cli/serve.ts` keeps the dev shell.

Two things that generalise beyond this instance:

- **A floor that rests on tree-shaking is not a floor.** Extracting `hostApp` removed the six symbols, but
  `compiledAppConfig` still imported four pure predicates that happened to live in `loadApp.ts`, so the
  whole discovery graph was one keyword away and only Bun's optimiser kept it out — and a test cannot
  assert a property only the optimiser holds. The predicates' own comments already called them a shared
  rule; they now have a module (`appModuleShape.ts`). 934 KB → 730 KB.
- **The guard is a static import walk, not a `Bun.build` of the entry.** The build probe is more faithful
  and was the first draft, but it reads several hundred files and went red whenever anything else in the
  tree was mid-write. A floor test that fails for unrelated reasons gets deleted, not obeyed.

`Bun.build` IS still in the binary and is expected to be — it arrives through the ROUTER
(`chunkAsset`/`navRoute` import `clientBuildFor`), since an app served without a prebuilt client must
produce one. The test names it as the CONTROL, so an empty offender list means absence rather than a
broken walk. Two small `cli/` edges remain (`parsePort`, `installShutdownHandlers`) and are harmless:
argv and signal handling, no heavy deps, and the walk proves they pull nothing.

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
