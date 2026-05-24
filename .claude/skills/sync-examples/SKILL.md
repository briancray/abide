---
name: sync-examples
description: After a belte API change, examine the codebase and update every example (and the bundled scaffold template) so they compile and demonstrate the new API. Use when the user changes the public API surface (renames an export, changes a verb helper signature, adds/removes a cache option, restructures routes, etc.) and the examples need to catch up.
---

# Keeping belte examples in sync with the library

There are four user-facing surfaces that must agree:

1. `packages/belte/template/` — the bundled scaffold (shipped via `bunx belte scaffold`)
2. `examples/scaffold/` — runnable workspace copy of the template
3. `examples/barebones/` — single-page minimum
4. `examples/kitchen-sink/` — feature-rich showcase

They drift the moment the library changes. This skill brings them back together.

## Step 1 — locate the change

Establish what actually changed before touching examples. Useful entry points:

- `packages/belte/package.json` `exports` map — the public import surface
- `packages/belte/bin/belte.ts` — CLI command names and flags
- `packages/belte/src/lib/types/` — every published type (`AppModule`, `RemoteFunction`, `CacheOptions`, `App`, `RequestStore`, …)
- `packages/belte/src/lib/rpc/handler.ts` — `handler.<VERB>(fn)` verb helpers (one per file under `src/rpc/`; the export name must match the filename)
- `packages/belte/src/lib/shared/cache.ts` — `cache()` and `cache.invalidate()` API
- `packages/belte/src/belteResolverPlugin.ts` — recognized page leaves (`page.svelte`, `layout.svelte` under `src/pages/`), rpc files (one `.ts` per URL under `src/rpc/`), path aliases (`$pages`, `$rpc`, `$lib`), virtual module names

If the change isn't named in the conversation, run `git log -p --stat -n 20 packages/belte/src` to find recent edits to the library — but prefer asking the user when the scope isn't obvious.

## Step 2 — choose what to demonstrate where

Each example has a job. Don't overcrowd the smaller examples.

| Example | Demonstrates |
|---|---|
| `examples/barebones` | The absolute minimum: one `page.svelte`, nothing else |
| `examples/scaffold` | Exactly one of every file type the framework recognizes |
| `examples/kitchen-sink` | Everything together: layouts, remote functions, `cache()` + invalidation, sockets, auth, Tailwind |

`packages/belte/template/` must be content-identical to `examples/scaffold/` aside from `package.json` (template uses `"belte": "^x.y.z"`, example uses `"belte": "workspace:*"`) and `tsconfig.json` (example extends `../../tsconfig.base.json`, template is self-contained).

## Step 3 — apply the change

For each affected example, work through:

- **Imports** — if a module path moved (e.g. `belte/foo` → `belte/bar`), update every `import` and `from ''` string. Grep across `examples/**` and `packages/belte/template/**`.
- **Type augmentations** — if a type's shape changed (e.g. a new field, a renamed field), update `declare module '…'` blocks. `examples/kitchen-sink/src/app.ts` and `examples/scaffold/src/app.ts` both augment `belte/types/App`.
- **Handler call sites** — `handler.<VERB><Args, Return>(...)` signatures must match the current helper definition. Each rpc file holds exactly one `export const <name> = handler.<VERB>(...)` whose `<name>` matches the file's stem.
- **`cache()` call sites** — `cache(fn)()` vs `cache(fn, options)()`. If options shape changed, update every site.
- **Page / rpc layout** — pages live under `src/pages/` (folder-based, `page.svelte` + `layout.svelte`). Rpc modules live under `src/rpc/` (one `.ts` per URL). If recognized leaves or directory conventions changed, rename files and update every importer.
- **CLI scripts** — `package.json` `scripts` use `belte <cmd>`. If a command was renamed (e.g. `create` → `scaffold`), update.
- **Comments inside template/scaffold files** — these are user-facing documentation, not throwaway. If the comment describes behavior that changed, update the comment.

When in doubt about whether a comment in a template file is load-bearing, leave it — but make sure it isn't now wrong.

## Step 4 — keep template ↔ scaffold byte-identical

The bundled `packages/belte/template/` is what `bunx belte scaffold` copies. `examples/scaffold/` is the runnable copy. After editing one, mirror to the other. Files that should be byte-identical:

- `src/app.html`
- `src/app.css`
- `src/app.ts`
- `src/pages/layout.svelte`
- `src/pages/page.svelte`
- `src/pages/about/page.svelte`
- `src/rpc/getHello.ts`
- `svelte.config.js`

Files that legitimately differ:

- `package.json` — template uses `"belte": "^x.y.z"` (pin to the current `packages/belte/package.json` `version`), example uses `"belte": "workspace:*"`
- `tsconfig.json` — template is self-contained, example uses `"extends": "../../tsconfig.base.json"`
- `.gitignore` — template ships one; example doesn't need its own (covered by repo root)

Use `diff -ruN packages/belte/template/src examples/scaffold/src` to confirm the `src/` trees match before committing.

## Step 5 — verify

For each updated example, run `bun run build` from the example directory and confirm:

- Build exits 0
- Resolver logs include the expected counts ("resolved N rpc modules: …", "resolved N pages: …", "resolved N layouts: …")
- `dist/_app/` contains a `client.js`, a `client.css` (if any CSS is imported), and `.gz` siblings for each output

Also test the scaffold path itself if `bin/belte.ts`, `src/scaffold.ts`, or `packages/belte/template/` changed:

```sh
rm -rf /tmp/belte-skill-check
bun packages/belte/bin/belte.ts scaffold /tmp/belte-skill-check
ls /tmp/belte-skill-check  # should contain package.json, src/, tsconfig.json, svelte.config.js, .gitignore
rm -rf /tmp/belte-skill-check
```

Don't `bun run dev` from a long-running shell — the project's CLAUDE.md prohibits it.

## Step 6 — README

If the change is user-visible (new file type, new helper export, new CLI flag, removed feature, renamed module), the README is also out of date. Hand off to the `write-readme` skill (or invoke it inline) to regenerate after examples are settled.

## Style for any code you write

The repo's CLAUDE.md applies in full. Notable for examples:

- Svelte 5 syntax (`$props`, `$state`, `$derived`, `{@render children()}`)
- `undefined` over `null` for nullish values
- Functional style, prefer `map` / `reduce` over loops
- Tailwind classes when the example already uses Tailwind (kitchen-sink); plain CSS otherwise (template, scaffold, barebones)
- Comments use `/* … */` blocks, not `//` series, when spanning more than one line
- One export per file (rpc modules must have exactly one; the export name matches the filename)
