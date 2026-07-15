---
"@abide/abide": minor
---

`await` now blocks a **script** read the same way it blocks a template read — pending propagates through the whole dependency graph (ADR-0046).

Previously only *template* reads of an `await`-marked `computed`/`linked` cell suspended; a *script* read (a `computed`/derive seed like `computed(() => result.root)` over a blocking `result`) peeked `undefined` while pending, so on a cold client navigation a downstream script derivation dereferenced `undefined` and crashed. Now a read of a pending blocking cell suspends its reader wherever it happens: a derive over it withholds and re-runs on settle, an async seed that reads a pending blocking dependency stays pending (not error), and the SSR barrier drains to a fixpoint so chained blocking cells resolve in order and bake correct values into the first-pass HTML.

Whether a read pauses is now a property of the **cell** (its `blocking`/`await` bit — the same one that decides SSR-barrier registration), not of the read site: there is one read callee, `$$readCell`, script and template, client and server. The separate `$$readCellBlocking` codegen path and the `abide/ui/dom/readCellBlocking` export are removed; bare/streaming reads (no `await`) are unchanged.

**Breaking:** a script read of an `await` cell now suspends where it previously returned `undefined` while pending. Read a blocking cell inside a `computed`/derive or the template — a plain top-level `const x = cell.field` cannot pause (it is not a graph node) and is fatal at mount, exactly as `undefined.field` already was.
