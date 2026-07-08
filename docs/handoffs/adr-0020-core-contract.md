# ADR-0020 core implementation contract (decisions frozen)

Read `docs/adr/0020-cache-policy-on-the-endpoint.md` + `docs/handoffs/adr-0020-implementation-brief.md` first — this file resolves the ambiguities they left open. Where this file and the ADR prose disagree, **this file wins** (the disagreements are noted and were forced by the codebase reality that `jsonl`/`sse` are response builders, not rpc helpers).

The pre-step rename (`Subscribable → NamedAsyncIterable`) is ALREADY DONE and committed. Use `NamedAsyncIterable`.

## Hard rules for the implementer
- **DO NOT touch git.** No `git checkout`, `git switch`, `git branch`, `git commit`, `git stash`, `git reset`. Only edit/create/delete files. The orchestrator owns all git. (A prior agent switched branches and made a mess — do not repeat.)
- Do not edit anything under `.claude/worktrees/*` (stale duplicates).
- biome ignores `src/lib` — hand-style to match surrounding code there. You may `bun run format` files OUTSIDE `src/lib`.
- The full call-site + reader inventory is in the orchestrator's context; the paths below are authoritative. Grep to confirm before editing.

## Decision A — opts shape (namespaced, kind-scoped by helper)

Single canonical source (sweep finding #4): one options type that `RpcHelper`, `defineRpc`, and `RpcRegistryEntry` all project from. Kind-scoping is by the two existing helper bases:

- **Read helpers (GET/HEAD) opts** carry: `schemas?`, `clients?`, `crossOrigin?`, `maxBodySize?`, `timeout?`, **`cache?`**, **`stream?`**. NO `outbox`.
- **Mutating helpers (POST/PUT/PATCH/DELETE) opts** carry: `schemas?`, `clients?`, `crossOrigin?`, `maxBodySize?`, `timeout?`, **`outbox?`**. NO `cache`, NO `stream`.

So `POST(fn, { cache: {...} })` is a compile error (the brief's stated D2 win: "a POST opts type has no cache"). `timeout`/`maxBodySize`/`crossOrigin`/`clients` stay top-level scalars/keys (unchanged).

**Deviation from ADR prose (must be noted in the ADR + reported):** the ADR says `stream` lives "on jsonl/sse kinds only" and `cache` on "cacheable reads only", implying finer scoping than read-vs-write. But there are NO jsonl/sse *helpers* — streaming is a GET/POST whose handler returns `jsonl()`/`sse()`, detected syntactically by the bundler. So streaming-vs-non-streaming is NOT knowable from the helper type. We put both `cache` and `stream` on the **read (GET/HEAD)** base. Rationale: `stream.n` (replay depth) is a subscribe/read concept; streaming feeds are GET. A streaming GET carrying `cache`, or a non-streaming GET carrying `stream`, is allowed-but-inert (not compile-rejected) — finer gating would require conditioning opts on the handler's inferred return type, exploding the generics for marginal benefit. Document this as an accepted trade-off.

### `schemas`
`schemas?: { input?: StandardSchemaV1; output?: StandardSchemaV1; files?: StandardSchemaV1 }` replaces the flat `inputSchema`/`outputSchema`/`filesSchema`. This drives **handler arg inference** — the non-mechanical part. Overload set in `RpcHelperOf<Opts>` (and its Durable mirror), by declining specificity:
1. `opts: Opts & { schemas: { input: InputSchema; files: FilesSchema } }` → args = `InferOutput<input> & InferOutput<files>`, RemoteFunction Args = `InferInput<input>`.
2. `opts: Opts & { schemas: { input: InputSchema } }` (input present; optional output; no files) → args = `InferOutput<input>`, Args = `InferInput<input>`.
3. `opts: Opts` (schemaless-with-opts, includes `schemas: { output }`-only) → args off the handler `F`.
4. `(fn: F)` bare → args off `F`.
`output` never drives arg inference (it's the success-body schema for OpenAPI/MCP). Keep the existing `SuccessBody`/`InferredErrors` machinery unchanged; only the schema *access path* moves from `opts.inputSchema` to `opts.schemas.input`. Get overload ordering right (most-specific nested-key match first).

### `cache` policy type
`cache?: { ttl?: number; tags?: Tags; throttle?: number; debounce?: number; shared?: boolean }`.
`tags` accepts `string[] | ((args: Args) => string[])`. This makes the cache-policy type **generic over `Args`** — thread `Args` through so the `(args) => string[]` form is typed. Reuse `CacheOptions` for the value-shape where possible (see Decision C).

### `stream` policy type
`stream?: { n?: number }`. `n` has NO runtime consumer today (pure type move — `subscribableFromResponse` ignores it); still thread it onto the definition/registry for completeness and future use.

## Decision B — smart bare call is `fn(args)`; policy on the endpoint (D1)

- `createRemoteFunction.ts`: `callable(args)` drops the `opts?` param for the cache path. The smart-read route becomes `cache.read(callable, args)` with NO call options. `.raw(args, init)` KEEPS `RpcOptions` transport opts (unchanged). The streaming branch is unchanged.
- `RemoteCallable<Args, Resolved, Opts>`: for `RemoteFunction` the call signature drops the trailing cache-opts — the bare call takes only `args` (+ FormData escape hatch). `RawRemoteFunction` keeps `Opts = RpcOptions`. Simplest: make the `RemoteFunction` callable `Opts = never`/absent so `fn(args)` is the whole signature; `.raw` retains `RpcOptions`. Update the doc comment (it currently says the RemoteFunction call carries `SmartReadOptions`).
- `RemoteFunction.ts`: remove the `SmartReadOptions` third type-arg. Add readonly endpoint-policy fields the client reads: `readonly cache?: <CachePolicy>` and `readonly stream?: <StreamPolicy>` (ships to client; harmless — behavior not secrets; `shared` is a client no-op). Update the `fn(args, opts)` prose to `fn(args)`.
- `createRemoteFunction` opts gains `cache?`/`stream?` policy inputs; it stamps them onto `callable.cache`/`callable.stream` so `readThrough` can read endpoint policy off the RemoteFunction.

## Decision C — cache.ts: read endpoint policy, delete swr, drop call-override

- **`readThrough` merge** simplifies from `method-default → call-override` to `method-default → endpoint-policy`. The endpoint policy comes from the RemoteFunction (`remote.cache`), read as the bottom layer. Remove the call-`options`-as-override plumbing for the SMART/remote path.
- **`swr` fully removed:** delete the `boolean | { throttle; debounce }` union from `CacheOptions`; delete `swrWindow`'s swr-branch handling (SWR is now unconditional for replayable reads — the window is just `throttle`/`debounce` on the endpoint `cache` policy); delete the three `validatePolicy` guards (throttle+debounce-both, swr-on-`ttl:0`, swr-on-non-replayable). `validatePolicy` may disappear entirely or shrink to the throttle-xor-debounce check if still meaningful for producers — keep only what still guards a real case.
- **`cache()` explicit API — producer keeps options, remote loses them.** A remote rpc has an endpoint to carry policy; a plain producer does not. So:
  - `cache(remoteFn, args)` / `cache(rawFn, args)` — drop the call-site `options` param; policy is read from the endpoint (or method-default for a raw producer-less call). "No call-site cache options anywhere" (brief done-criteria) applies to remotes.
  - `cache(producer, args, options?)` — KEEPS `options?: CacheOptions` (ttl/tags/throttle/debounce/shared — no swr). A producer has no definition; this is its only policy home. Document it.
  - `cache.read` (smart) takes NO options.
- `CacheSelector` / `patch` use `Pick<CacheOptions, 'tags'>` — keep working after the `tags` type change (tags value shape is still `string[]` at the selector level; the `(args)=>` form is a definition-only affordance — do not push the function form into selectors).
- The `ttl`-per-side interpretation, `keepZeroTtlForRequest`, `adoptTtl`, `attachPolicy`, `materializeRetained`, staleness/retain machinery all STAY — only their *input source* changes (endpoint policy instead of call options) and the swr union is gone.

## Decision D — RpcRegistryEntry (sweep finding #4)

- Derive its record from the canonical opts type (single source).
- **Drop the duplicate `clients` and `crossOrigin`** — every reader switches to `entry.remote.clients` / `entry.remote.crossOrigin`. Readers to fix: `discoveryEntry.ts:27,45`; `server/sockets/createSocketDispatcher.ts:285`; `server/runtime/logExposedSurfaces.ts:116-118,137-139`; `server/runtime/warnUnguardedMcp.ts:21` (also its structural param type); `mcp/mcpTools.ts:40,46`; `server/runtime/buildInspectorSurface.ts:26` (crossOrigin). Keep `timeout`/`maxBodySize` on the entry (genuinely registry-only). Add `cache`/`stream` policy to the entry if any server reader needs it; else it can ride only on `remote`.
- `defineRpc.ts`: read `opts.schemas.input/output/files` (was flat), read `opts.cache`/`opts.stream`, keep the `outbox` read-only-method guard, pass policy to `createRemoteFunction` and `registerRpc`.
- Bundler note: `prepareRpcModule` spreads opts **opaquely** (`...(opts)`), so the `schemas`/`cache`/`stream` nesting needs NO bundler change. Confirmed.

## Decision E — deletions / server verb files

- **Delete** `shared/types/SmartReadOptions.ts` and its two references (`RemoteFunction.ts:9,48`, prose in `RemoteCallable.ts:13`).
- `shared/types/CacheOptions.ts` — remove the `swr` union; it stays the shape for producer `cache()` options AND the endpoint `cache` policy value (they coincide: `{ ttl?, tags?, shared?, throttle?, debounce? }`). Update its doc comment (drop all swr prose; state SWR is unconditional for replayable reads).
- Server verb files (`GET/POST/PUT/PATCH/DELETE/HEAD.ts`) are inert typed stubs — only their `RpcHelper`/`MutatingRpcHelper` *type* changes flow through; the runtime bodies are untouched. `jsonl.ts`/`sse.ts` are response builders — untouched. `server/sockets/*` already carry `tail`/`ttl`/`clients` on `SocketOptions` — leave socket policy as-is (ADR-0020 is rpc opts; do not restructure sockets) EXCEPT switching any socket reader off a dropped registry field (none — sockets have their own registry).

## Decision F — call-site migration (get to FULL green)

Migrate every caller so `bun run typecheck` AND `bun run test` are green.
- **Example rpc definitions** (flat schema → `schemas: {}`): kitchen-sink `chat.ts:86`, `checkout.ts:42`, `convertTemp.ts:43`, `countLog.ts:30`, `createEcho.ts:15`, `getEcho.ts:15`, `getProduct.ts:31`, `publishChat.ts:36`, `saveMessage.ts:25`, `trackPageview.ts:24`, `uploadNote.ts:26` (input+files), `users/list.ts:20`.
- **Smart bare calls with opts** → `fn(args)` + move policy to the definition: kitchen-sink `probes/page.abide:10` (`createEcho(args, {ttl:0})` → move `cache:{ttl:0}` to createEcho's def, call `createEcho(args)`), `probes/page.abide:22` (`getRates({base:'USD'},{debounce:300})` → `cache:{debounce:300}` on getRates def... but getRates takes an arg-derived tag too — check getRates.ts). Update the doc-string demo snippets in the `.abide` CodeBlock props for consistency (probes/page.abide:55,77,111; cookbook/*; getRates.ts:10 comment) to the new `fn(args)` + endpoint-policy form.
- **Test rpc definitions**: all the `defineRpc`/`GET`/`POST` sites in tests listed in the inventory (buildOpenApiSpec, createClient, defineRpc, files, mcpDispatch, mcpRequestScope, rpcInferredErrors, rpcTypedErrors, socketTools, streamingRpc, warnUnguardedMcp, prepareRpcModuleOutbox string fixtures) → `schemas: {}`.
- **`smartRemoteCall.test.ts`**: the bare-call-with-opts cases (`getThing(undefined,{shared,ttl,tags})`, `getShared`, `getRates`, `getWarn`, `getFine`, `getN`) must move policy to the rpc definitions used in the test and call `fn(args)`. Rework the test rpcs to declare `cache: {...}` so the assertions still hold.
- **swr-exercising tests** (`cacheInvalidatePolicy.test.ts`, `cacheTtlLifecycle.test.ts`, etc.): these call the EXPLICIT `cache(fn, args, {swr...})`. Since remote `cache()` loses options and swr is gone: convert them to the new model — for a REMOTE, declare the `throttle`/`debounce` (former swr window) as `cache:` policy on the test's rpc definition and call `cache(fn, args)`; for a PRODUCER, keep `cache(producer, args, {throttle|debounce})` (no swr). Any test asserting a DELETED guard (swr-on-ttl:0 throw, swr-on-write throw, throttle+debounce-both throw) must be updated: drop the swr-specific throw assertions; keep the throttle-xor-debounce throw only if you retained that guard. Preserve each test's BEHAVIORAL intent (what retention/refetch it verifies) — do not just delete assertions to make it pass; rewrite them against the new endpoint-policy model.
- Update doc comments in `cache.ts:71,82`, `buildCacheSnapshot.ts:51`, `sharedCacheStore.ts:6`, `sharedCacheStoreSlot.ts:5`, `startClient.ts:71` that show the old `cache(fn,args,{ttl:0})` remote idiom.

## Done criteria for THIS agent
- `bun run typecheck` exits 0 (from repo root).
- `bun run test` passes (packages/abide tests + example tests).
- No `SmartReadOptions` identifier remains; no `swr` option remains in `CacheOptions` or `cache.ts` logic; no smart bare call passes cache options; `RpcRegistryEntry` has no `clients`/`crossOrigin`.
- Do NOT regenerate AGENTS.md / run readmeSurfaces yet (orchestrator does that after review), but DO leave the `exports` map + `@documentation` tags correct if you renamed/deleted any exported module path (SmartReadOptions was not exported per inventory; CacheOptions path unchanged).
- Report: files changed, the key type-inference approach you took for `schemas`, how you handled the swr-test rewrites, and the final typecheck + test output (tail).