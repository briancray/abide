# Handoff brief — pre-step 0: rename `Subscribable` → `NamedAsyncIterable`

**Do this FIRST, as its own commit, before Agent A (ADR-0020) or Agent B
(ADR-0019) branch.** Both edit `RemoteFunction`/`Socket`, so landing this rename
up front keeps their parallel work conflict-free.

**Context:** `docs/adr/0019-async-computeds-and-rpc-auto-reads.md` (Consequences +
the `NamedAsyncIterable` decision). `Subscribable` conveys nothing to an
unfamiliar reader; the type is literally an `AsyncIterable<T>` carrying a `name`,
so `NamedAsyncIterable<T>` says the two things that matter (you can `for await` it;
it has an identity).

## Task

Pure mechanical rename — **shape unchanged** (`extends AsyncIterable<T>` +
`readonly name: string` + optional `tail?(count, hooks?)`). No behavior change.

1. `shared/types/Subscribable.ts` → `shared/types/NamedAsyncIterable.ts`; rename
   the interface.
2. Update all usages:
   - `Socket.ts` (Socket satisfies/extends it)
   - `RemoteFunction.ts` (streaming rpc's bare-call return type)
   - the stream probes: `pending` / `refreshing` / `done` / `error` / `peek`
     (wherever they name the `Subscribable` form)
   - `watch` / `cache.on` intake
   - `assembleSubscribable` and the `FrameSource` wrapping (CONTEXT.md names these
     — check whether `assembleSubscribable` should also rename; the *shell* it
     produces is the renamed type, but confirm against ADR-0018's target naming
     before renaming that helper — it may be mid-realignment).
3. `package.json` `exports` map (if `Subscribable` has a public module path) + the
   `// @documentation` tag.
4. Regenerate the surface: `bun run packages/abide/scripts/readmeSurfaces.ts`;
   sync `AGENTS.md`. Update `CONTEXT.md` where it says `Subscribable.name` /
   `Subscribable.tail` (the Tail and FrameSource entries reference it).

## Caution

- ADR-0018's vocabulary realignment is mid-flight and CONTEXT.md marks several
  stream-side names as *(target)*. Do **not** rename `FrameSource` or
  `assembleSubscribable` as part of this — only `Subscribable` → `NamedAsyncIterable`.
  If a target rename in 0018 conflicts, defer to 0018's table and flag it.

## Done criteria

- No `Subscribable` identifier remains (grep clean) except in ADR/CONTEXT prose
  describing the rename.
- Typecheck + tests green. `bun format` touched files (biome ignores `src/lib` —
  match surrounding style).
