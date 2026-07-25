# SESSION HANDOFF — primitive unification (2026-07-25)

Temporary file. Delete once the work below lands.

Goal: the codebase is fully unified under **`state` / `memo` / `channel`** as the isomorphic primitives and
**`socket` / `rpc`** as the isomorphic transports.

---

## 1. WORKING TREE — everything below is UNCOMMITTED

Branch `rewrite`, base `26a4a99e`. Stages A and B are **done and verified green**. Stage C is **designed
but not built** (one unused file exists — see §4). Stage D is **not started**.

**The tree is mixed — these two are NOT this session's work:**
```
packages/bench/run.ts                  <-- another agent: every metric now also runs a vanilla baseline
packages/bench/src/vanillaBaselines.ts <-- another agent, untracked
```
Commit file-scoped. **Never `git commit -a` / blanket-stash.**

---

## 2. STAGE A — retire the name `signal` → `state` ✅ DONE

`shared/internal/reactive.ts` now exports the atom as `state`/`State`; the name `signal` is gone from the
reactive vocabulary (only `AbortSignal` / `options.signal` / `SIGINT` remain, correctly).

- `Reactive`'s node field `state` → `status` (it was the staleness enum, colliding with the new name).
- `memo.ts`'s `slot.signal()` → `slot.state()`.
- Swept: runtime, online, routeHolder, iterableDone, pending, refreshing, socketProxy, emitFixtures, tests.
- `shared/state.ts`'s `State<T>` now **extends** the atom's `State<T>` + the kind brand — one shape, not two.
- Bench: recipe group `signal` → `state`, `gate.ts` denominators `signal/get` → `state/get`.

**Two traps this hit — both invisible to `bun test`:**
1. `emitClient.ts` emitted the *string* `$rt.signal(...)` for keyed `{#for}` item cells. Typecheck cannot
   see emitted strings. Now `$rt.state(...)`. **Grep emitted strings on any runtime rename.**
2. A renamed oracle fixture ORPHANED two snapshots and auto-**added** two new ones — which *passes*
   silently. Values were byte-identical, orphans deleted. Watch for "N added" in the snapshot line.

Also fixed: `sharedCache.test.ts` cast to `{ signal: … }` structurally (typecheck can't catch it).

## 3. STAGE B — `channel` is now isomorphic ✅ DONE

`channel` was server-only; the three primitives are supposed to be isomorphic.

- `server/channel.ts` → **`shared/channel.ts`**
- `server/internal/socketHub.ts` → **`shared/internal/channelHub.ts`**, class `SocketHub` → `ChannelHub`,
  options narrowed to its own `ChannelHubOptions {tail?, ttl?}` (it took a `SocketOptions`, which was the
  only thing making the pub/sub core depend on the transport). Nobody read `hub.options`; field dropped.
- `DROP` moved out of the hub to **`server/DROP.ts`** — it is socket-layer mediation, not pub/sub, and it
  was documented in CLAUDE.md with no export path at all.
- Verified genuinely client-safe: `bun build shared/channel.ts --target=browser` → 6 modules, 9.74 KB.
- Added two guards in `shared/channel.test.ts`: surface-parity with `memo`, and a browser-shaped run.

## 4. STAGE C — designed, NOT built. Read `docs/adr/0024-memo-absorbs-derivation.md` first.

`state.computed`/`state.linked` fold into `memo`. The ADR is complete and settled — it supersedes ADR
0023's `state`-family table and records the rationale, the rejected alternatives, and the file/line
evidence for each mechanical claim.

No Stage-C code exists in the tree. An earlier `shared/internal/stateCell.ts` was written against a
superseded shape (`makeComputedCell`/`makeLinkedCell`) and has been **deleted** — start from the ADR, not
from a half-built factory.

**Do not re-litigate:** the old objection ("a `linked` write persists, a `memo` publish is provisional")
is void — those are the same sentence. See ADR 0024 §Context.

## 5. STAGE D — truth-up. NOT started.

Four surfaces: `docs/spec/*.md`, root `CLAUDE.md`, `packages/docs`, `packages/starter`.

Known-stale, found this session:
- **`docs/spec/promise-read-model.md:39-42,49` is WRONG.** It says a bare `{rpc()}` renders
  `[object Promise]` as a "deliberate, loud failure". It does not — `interpolate` auto-awaits thenables
  (`runtime.ts:509-513`) and the server awaits *every* interpolation (`emitServer.ts:248`).
  **CLAUDE.md:288 is correct.**
- `CLAUDE.md` log-channel list says `abide:cache`; the code emits `abide:memo`. Actual channels:
  `bundle, cli, hydrate, identity, memo, rpc, ssr, stream`. The listed `router/socket/agent/mcp` are unused.
- `CLAUDE.md` "cache verbs" → "surface verbs" (ADR 0023 §Naming alignment).
- `CLAUDE.md` has **no `channel` row** in the isomorphic table, and its "All are isomorphic" line now needs
  to actually include `channel` (it does, as of Stage B).
- `docs/adr/0023-step7-conceptual-thesis-DRAFT.md` still calls the atom `signal` and says channel's
  isomorphic face is the socket — both now false. Still awaiting approval to apply; reconcile or drop.
- `packages/docs/CAPABILITIES.md:178-179,215` document `state.computed`/`state.linked`.

## 6. VERIFICATION — commands and gotchas

```
cd packages/abide && bun test          # MUST be package cwd — repo root => ~236 bogus failures
cd packages/abide && bun run typecheck
cd packages/docs  && bun run typecheck
cd packages/abide && bun src/cli/bin.ts check ../docs
bunx biome check packages/abide/src    # from repo root
bun run bench:gate                     # from repo root
cd packages/docs  && bun run e2e:ci    # serial; ~3.5 min
```

**Green at end of Stage B:** abide `bun test` **1192 pass / 0 fail** (178 snapshots) · abide typecheck 0 ·
docs typecheck 0 · `abide check` on docs clean · biome clean (6 pre-existing warnings) · bench gate 6/6.

**`bench.spec.ts` has 2 PRE-EXISTING failures** — "re-run button re-invokes the corpus" and "soft-nav …
seedOverride path". Verified by running them in a clean `git worktree` at `26a4a99e`: they fail there too.
Not caused by this session's work, and not by the bench agent's `run.ts` (also verified by swapping it).
The prior handoff's claim of 154/154 e2e green does not reproduce. Everything else passes.

Other gotchas: `grep -c` exits 1 on zero matches and will short-circuit an `&&` chain, silently skipping
your test run. Emit regressions pass `bun test` but break the docs app.
