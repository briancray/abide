# Handoff brief — implement ADR-0022

**Spec (read first, it is the contract):** `docs/adr/0022-build-transforms-resolve-through-the-module-graph.md`
**Also read:** `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md`, and ADR-0017 (side-crossing guard), ADR-0010 (shadow), ADR-0020 (endpoint policy — this reworks its client half).

## Goal

Stop reconstructing the client rpc module from extracted source text. Transform the
real module in place (symmetric to the server rewrite) so endpoint policy is ordinary
JavaScript that can reference imports / separate modules, and make the one
client-reaches-server guard reachability-based (post-DCE) so it neither false-positives
on the elided handler's dead imports nor lets real server code leak.

## Hard rules
- **NEVER run git** (no checkout/switch/branch/commit/stash/reset/add). The orchestrator owns all git.
- Do not edit `.claude/worktrees/*`. biome ignores `src/lib` — hand-style there; you may `bun run format` files outside `src/lib`.
- Do not run `readmeSurfaces.ts` / regenerate AGENTS.md (orchestrator does docs).
- If genuinely blocked, STOP and report specifics — do not weaken types, delete tests, or fall back to text extraction (the exact anti-pattern this ADR removes).

## Sequencing
1. **Migration first** — revert the ADR-0020 client-shipping mechanism: commit `ae560804` (`feat(rpc): ship endpoint cache/stream policy to the client stub`), i.e. delete `extractObjectProperty`/`readPropertyValue`/`cachePolicyText`/`streamPolicyText` and the text-splice. (The orchestrator handles the actual git revert; you implement the replacement.)
2. **D2 + D3 together** — they interlock (D3's reachability model is what lets D2 keep the module). One PR.
3. **D4** — separate PR/workstream; discovery-first (see below). Do NOT block D2/D3 on it.

---

## D2 — client rpc transform symmetric with the server rewrite

The server branch is `banner + prepared.rewriteForServer(url)` (`abideResolverPlugin.ts:417-419`); `rewriteForServer` keeps `stripped` (the module with only the user's `GET` import removed — client-safe imports, the handler, and server imports all remain) and injects `defineRpc("M","/url",` before the handler. Make the client symmetric.

**Files**
- `packages/abide/src/lib/shared/prepareRpcModule.ts`
  - Delete `extractObjectProperty`, `readPropertyValue`, `cachePolicyText`, `streamPolicyText`, and their fields on `PreparedRpcModule`.
  - Add `rewriteForClient(url)`, modeled on `rewriteForServer` but emitting a `remoteProxy` call with the **handler elided** and `streaming` injected. Use the existing `splitTopLevelArgs(stripped, site.parenStart, site.parenEnd)` → `[handler, opts]`. Emit:
    - no opts, non-streaming → `__abideRemoteProxy__("M","/url")`
    - no opts, streaming → `__abideRemoteProxy__("M","/url", { streaming: true })`
    - opts, non-streaming → `__abideRemoteProxy__("M","/url", ${opts})` (opts left verbatim — a live expression in the kept module)
    - opts, streaming → `__abideRemoteProxy__("M","/url", { streaming: true, ...(${opts}) })`
  - Keep the rest of `stripped` after the call's closing paren (same slicing discipline as `rewriteForServer`). The handler and its server imports stay textually; they tree-shake (proven safe by D3).
- `packages/abide/src/abideResolverPlugin.ts`
  - The client `onLoad` branch (~383-405): replace the whole-module-replace stub with `banner + prepared.rewriteForClient(url)`, where `banner = import { remoteProxy as __abideRemoteProxy__ } from '${importName}/ui/remoteProxy';`. Drop the `optsFields`/`extractObjectProperty` emission.
- `packages/abide/src/lib/ui/remoteProxy.ts`
  - Widen the third-param type (`DurableOptions`) to accept the endpoint opts shape — it already reads only `outbox`/`streaming`/`cache`/`stream` at runtime (`durable?.outbox === true`, `durable?.streaming ?? false`, and the cache/stream stamping added by ADR-0020). The extra endpoint keys (`schemas`/`clients`/`crossOrigin`/`timeout`/`maxBodySize`) are ignored. No runtime change — type only.

**Result:** `cache: ratePolicy` (imported), `cache: { ttl: RATE_TTL }` (imported const), or `stream` in a shared module all work client-side because `opts` evaluates in the real module. `outbox` rides the live opts (read at runtime); the build-time `outbox` scan stays only as the mutating-only/literal validation, not the value source.

## D3 — reachability-based client↛server guard (post-DCE metafile)

**Mechanism is validated** (Bun 1.3.14): `Bun.build({ metafile: true })` → `{ inputs, outputs }`; a textually-imported-but-unused module is absent from `metafile.inputs` (tree-shaken), a used one present, and each input carries `imports: [{ path, kind, original }]` edges. See the ADR D3 for the confirming spike.

**Files**
- `packages/abide/src/build.ts` (the client `Bun.build` call, ~line 77) — add `metafile: true`. (Confirm this is the client-target build; `buildArtifact.ts` wraps `Bun.build` too — thread the flag through so the client build produces a metafile.)
- `packages/abide/src/abideResolverPlugin.ts`
  - Register `build.onEnd((result) => …)`: on a **client** build, walk `result.metafile.inputs`, classify each *surviving* module with the existing `isServerOnlyModule` (under `serverDir` and not `isProxiedServerModule`). If any server-only module survived, throw a side-crossing error, reconstructing the import chain from the `inputs[path].imports` edges (BFS from an entrypoint to the offending module) — reuse/adapt `sideCrossingChain`/`showPath` for the evidence format `resolverSideCrossing.test.ts` expects.
  - **Relax the resolve-time throws** (`recordAndGuard` at :253, and the `$server`/relative throws at :293/:330) so they no longer reject at resolve — the rpc client module now legitimately *keeps* server imports until DCE removes them, so resolve-time presence is no longer a violation. The `onEnd` metafile pass is the sole authority. (Keep `importerOf` edge recording only if the onEnd chain builder still needs it; otherwise the metafile's own `imports` edges suffice and the edge map can go.)
- `packages/abide/tests/resolverSideCrossing.test.ts` — update to the reachability semantics: a server import only reached through an elided handler is **allowed** (not in the bundle); a server name a live client-reachable expression reaches is **flagged**, with the chain. Add a case proving an rpc whose `cache` policy imports a client-safe module builds clean, and one where a policy references a `$server/*` name fails with a chain.

**Do NOT** add the other matrix edges (`server→client`, `shared→client`) — the ADR explicitly rejects them (they ship no server code; abide's own SSR + isomorphic reactive core depend on them).

## D4 — `props<T>()` resolves through the shadow program (separate workstream)

Discovery-first — trace before editing. Entry points: `packages/abide/src/lib/ui/compile/compileShadow.ts`, `createShadowProgram.ts`, `createShadowLanguageService.ts`, `pagePropsType.ts`, and how the component `Props` type is synthesized from the inline `prop<T>()` calls. Goal: allow a props type resolved through the shadow's real program (an imported/aliased `Props`) instead of only the inline-literal harvest; the harvest becomes a fallback. Produce a short findings note + a follow-up brief before implementing — do not guess the authoring syntax.

## Done criteria (D2 + D3)
- `bun run typecheck` → 0; `bun run test` → green.
- A kitchen-sink rpc whose `cache` policy references an **imported** value (add one, e.g. `getRates` importing a `RATE_TTL` const or a shared `ratePolicy` object) builds and the client honors it — proving the self-contained constraint is gone.
- New/updated tests: client-side honoring with imported policy (extend `remoteProxyPolicy.test.ts`); reachability guard allows dead-handler server imports and flags a live-reached server name (`resolverSideCrossing.test.ts`).
- `prepareRpcModulePolicy.test.ts` updated: assert the emitted client module is the transformed real module (handler elided, `remoteProxy` call, live opts) — not a text-spliced stub. No `extractObjectProperty` remains.
- **Verify by driving a real build**, not just unit tests: run `abide build` on kitchen-sink, confirm the client bundle contains the policy and none of the handler's server-only code (grep the emitted bundle for a server-only marker to prove the guard/DCE works end-to-end).
