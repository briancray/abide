# Handoff brief — implement ADR-0020 (Agent A)

**Spec (read first, it is the contract):** `docs/adr/0020-cache-policy-on-the-endpoint.md`
**Also read:** `CLAUDE.md` (coding guidelines), `AGENTS.md` (public surface), `CONTEXT.md` (domain vocab — use "Registry"/"Probe"/"Replayable method" exactly).

## Goal

Move all cache/stream policy onto the rpc **definition**, delete call-site cache
options, make `swr` unconditional, and namespace the rpc opts. After this, the
smart bare call is `fn(args)` — no second argument.

## Scope — IN

1. **Namespace the rpc opts (D2).** Under cohesive keys, following the existing
   `clients` key:
   - `schemas: { input?, output?, files? }` replaces flat
     `inputSchema`/`outputSchema`/`filesSchema` (and their schema-bearing
     overloads). **This changes type inference** — the handler's arg type is now
     inferred from `opts.schemas.input` (nested-key conditional read). This is the
     one non-mechanical part; get it right.
   - `cache: { ttl?, tags?, throttle?, debounce?, shared? }` — cacheable-read
     kinds only.
   - `stream: { n? }` — streaming (`jsonl`/`sse`) kinds only.
   - `clients` unchanged. Scalars (`timeout`, `maxBodySize`, `crossOrigin`,
     `outbox`) stay top-level.
   - **Kind-scoping is type-enforced:** a `POST` opts type has no `cache`; a
     non-streaming has no `stream`. A misplaced option is a compile error.
2. **Cache policy to the definition (D1).** `cache`/`stream` policy rides onto the
   `RemoteFunction` and `RpcRegistryEntry`, and `readThrough` reads it as the
   bottom layer. The merge simplifies from `method-default → call-override` to
   `method-default → endpoint-policy` — **remove the call-override layer.**
3. **Delete call-site cache options.** `fn(args, opts)` → `fn(args)`. Delete
   `SmartReadOptions` (call-site type). `.raw(args, init)` keeps transport
   (`RpcOptions`) — untouched.
4. **`swr` always-on.** Remove the `swr` field, the `boolean | {throttle;debounce}`
   union, and the three wrap-time guards (swr+window conflict, swr-on-`ttl:0`,
   swr-on-non-replayable). SWR is unconditional for replayable reads.
5. **`tags` accepts a function:** `string[] | (args) => string[]`. No
   call-additive tags.
6. **Fold in sweep finding #4 (single-source the rpc record):**
   - One canonical rpc-options type that `RpcHelper`, `defineRpc`, and
     `RpcRegistryEntry` all project from (registry derives its record from it).
   - Drop the duplicate `clients`/`crossOrigin` from `RpcRegistryEntry` — every
     consumer reads `entry.remote.clients` / `entry.remote.crossOrigin`
     (router already does; fix the inspector/MCP/log readers). `timeout`/
     `maxBodySize` are genuinely registry-only, keep them.

## Scope — OUT (do not touch)

- Anything in ADR-0019: async cells, `{#try}`, probes-on-cells,
  `NamedAsyncIterable`. **The probe surface (`peek`/`pending`/`refreshing`/
  `error`) already exists on `RemoteFunction` — do NOT restructure it;** 0019
  extends it to cells later.
- The bare-rpc auto-read in templates (that is ADR-0019 D1, done after this).
- The `method-derived` defaults themselves (`REPLAYABLE_METHODS`, the `ttl:0`
  server/write defaults) — keep them; they are the base layer.

## Files (ownership)

- `server/rpc/types/RpcHelper.ts` — `RpcBaseOpts`/`MutatingRpcOpts` → namespaced; the canonical opts type
- `server/rpc/defineRpc.ts` — opts shape + registry population
- `server/rpc/types/RpcRegistryEntry.ts` — drop dup `clients`/`crossOrigin`; add cache/stream policy
- `server/GET.ts` / `POST.ts` / `PUT.ts` / `PATCH.ts` / `DELETE.ts` / `HEAD.ts` — opts pass-through markers
- `server/jsonl.ts` / `sse.ts` — `stream` policy
- `server/sockets/*` — tail/stream policy on the socket definition
- `shared/cache.ts` — `readThrough` merge (drop call layer, add definition layer); remove swr guards
- `shared/types/SmartReadOptions.ts` — **delete**
- `shared/types/CacheOptions.ts` — becomes the definition cache-policy type; remove `swr` union
- `shared/createRemoteFunction.ts` — bare call drops the opts arg; `RemoteFunction` carries policy
- `shared/types/RemoteFunction.ts` / `RemoteCallable.ts` — call signature `fn(args)`; policy fields
- validate-policy / swr-window helpers — delete the swr guards

## Coordination (overlap with Agent B / ADR-0019)

- `RemoteFunction.ts`, `createRemoteFunction.ts`, `cache.ts` are the shared seam.
  **Agent A owns the call-signature + policy change here; Agent B's D1 builds on
  top later.** Do not block on B.
- **Pre-step 0 (shared):** the `Subscribable → NamedAsyncIterable` rename lands
  *before* both agents branch (it touches `RemoteFunction`/`Socket`, which both
  edit). Assume it is already done — use `NamedAsyncIterable`.

## Done criteria

- Smart call is `fn(args)` everywhere; no call-site cache options anywhere.
- Definition opts namespaced; kind-scoped types compile-reject misplaced options.
- `readThrough` has no call-override layer; `swr` union + guards gone.
- `RpcRegistryEntry` no longer duplicates `clients`/`crossOrigin`.
- Call sites migrated (examples/scaffold/kitchen-sink + tests): policy on the
  definition, call is `fn(args)`.
- `bun run packages/abide/scripts/readmeSurfaces.ts` regenerated; AGENTS.md synced.
- Typecheck + tests green. Run `bun format` on touched files (note: biome ignores
  `src/lib`, so that tree is hand-styled — match surrounding style).
