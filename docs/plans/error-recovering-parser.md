# Plan: error-recovering template parser (unify compile + LSP + diagnostics)

Status: **not started** — captured for later. The cheap down payment (a shared
block-keyword vocabulary) is already shipped; this is the full version.

## Goal

Replace the current fail-fast `parseTemplate` + the two hand-rolled LSP lexers with **one
error-recovering parser** that produces a `(partial tree, diagnostics[])` for any input —
so a single grammar drives the compiler, the LSP highlighter, and diagnostics.

## Why (the problem it solves)

`parseTemplate` today is **fail-fast**: the first malformed thing (`{#if}` with no
condition, an unclosed tag, an unknown block) **throws** and yields no tree
(`src/lib/ui/compile/parseTemplate.ts` — the `throw` sites). That's correct for
compilation, but it forces two workarounds:

1. **Two parallel hand-rolled lexers exist only to survive unparseable mid-edit source**
   — `src/lib/ui/compile/markupTokens.ts` (~313 lines) and `structuralBlockTokens.ts`
   (~100 lines), each "a pure scan of raw source, independent of a successful parse." They
   duplicate grammar knowledge the real parser already owns, and **drift**: `{#snippet}`
   heads went uncolored because `structuralBlockTokens`'s keyword list had fallen behind
   the parser.
2. **Diagnostics are one-error-at-a-time** — the parser throws on the first error, so the
   editor shows one squiggle at a time instead of all errors in a file.

Already shipped as the down payment (commit `95ac19a0`): `BLOCK_KEYWORDS.ts` — a shared
opener/connector vocabulary both the parser's error message and the highlighter consume,
plus a guard test. That killed the drift that actually bit. **This plan is the full fix.**

## What it unlocks

1. **Delete both hand-rolled lexers** (~410 lines) — drive highlighting from the real AST,
   which now exists even mid-edit. One grammar, one source of truth; the drift class is
   gone for good.
2. **Multi-error diagnostics** — report every error in a file at once.
3. **Hover / completion while typing** — a (partial) tree exists on broken source, so
   language features work mid-edit.
4. **Table-driven block dispatch** — the parser's opener dispatch (currently a chain of
   inline `keyword === 'if' | 'for' | …` in `parseTemplate`) becomes data-driven from
   `BLOCK_KEYWORDS`, so the parser literally can't accept a keyword the vocabulary omits.

## Design sketch

- The parser never throws on malformed input. On an error it **inserts a synthetic error
  node, records a diagnostic, and resyncs** to a safe point, then keeps going. It always
  returns `{ nodes, diagnostics }`.
- **Two output contracts, one rule:** the compiler wants "parse or fail"; the LSP wants
  "tree + diagnostics." Resolve with a single rule — **any diagnostic ⇒ the compiler
  throws.** Recovery is purely additive for the LSP; the compiler never accepts broken
  input.

## Guardrails (the "don't dig an early grave" discipline)

The rewrite is a net *consolidation* (deletes code, unifies the grammar) — on-goal for
abide's "small surface, high visibility" values. It only becomes a liability if you let
error recovery sprawl. Non-negotiables:

1. **Bounded resync, not perfect recovery.** Resync to a *small fixed set* of points —
   next `{`, next `<`, block close, statement boundary — and accept imperfect recovery
   past that. **Never grow the heuristic set to chase edge cases.** This is the single most
   important discipline; it's where recovering parsers rot into the most-feared file in the
   repo.
2. **One contract rule:** any diagnostic ⇒ the compiler throws. Keeps a partial tree from
   silently compiling.
3. **Golden corpus first.** Snapshot the parse output of a large pile of real `.abide`
   files, then require **byte-identical output on the happy path** before/after. The parser
   is pure and well-tested — this makes the blast radius observable.
4. **Delete the lexers as the closing move**, so the win (one source of truth) is banked.

## Costs / risks

- **Rewrites the control flow of the single most load-bearing compile file.** Every
  component — SSR, client, type-check — parses through `parseTemplate`. A subtle regression
  ships everywhere. (Mitigant: golden corpus + the parser's existing purity/tests.)
- **Recovery heuristics are the hard part** — resync-point choices interact; bad ones
  cascade one real error into a cloud of spurious ones.
- **The two-contract seam** must be exactly right, or the compiler accepts broken input.
- **Big test surface** — every malformed-input shape needs coverage for both the
  diagnostic/resync and the partial tree.
- **Effort:** ~3–5 focused days — rework the parser to accumulate diagnostics + insert
  error nodes + resync (~1–2d), the compiler-vs-LSP contract (~0.5d), delete the lexers and
  repoint the LSP (~0.5d), plus a thorough malformed-input suite.

## When to do it

Not urgent — the shipped keyword-share already removed the drift that bites. This is a
"focused multi-day window, editor DX is the priority" project, done deliberately with the
guardrails above. Don't squeeze it in between other work; a rushed recovery layer is
exactly how it turns into the liability.

## Concrete starting points

- `src/lib/ui/compile/parseTemplate.ts` — the `throw` sites to convert to
  error-node + diagnostic + resync; the inline opener dispatch to make table-driven.
- `src/lib/ui/compile/BLOCK_KEYWORDS.ts` — the shared vocabulary the table-driven dispatch
  builds on (already exists).
- `src/lib/ui/compile/markupTokens.ts`, `structuralBlockTokens.ts` — to delete once the AST
  drives tokens.
- `src/abideLsp.ts` (`componentSemanticTokens`) — repoint from the two lexers to the AST.
- The compiler entry (`analyzeComponent` / `compileModule`) — enforce "any diagnostic ⇒
  throw."
