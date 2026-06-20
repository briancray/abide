---
name: write-readme
description: Regenerate the abide README (the curated 3-primitive intro) and AGENTS.md (the exhaustive public-surface map). Use when the user asks to rewrite or refresh the README or AGENTS.md, or after API changes the docs should reflect.
---

# Writing the abide docs

This skill regenerates **two generated docs**, both re-derived from
`packages/abide/src` + `package.json` `exports` every run — never patched:

- **`packages/abide/README.md`** — the curated human intro. A lean pitch
  backed by three runnable artifacts (an RPC, a socket, one `.abide` component
  consuming both). It does **not** document every export; it teaches the three
  foundational primitives and the template grammar that ties them together.
- **`packages/abide/AGENTS.md`** — the exhaustive surface map. *Every* `exports`
  key appears, grouped by namespace, with its import specifier + a one-line
  spec, so an agent grasps the whole API in one read. This is where the
  every-export-accountable contract lives (it's why the README needn't).

Both are terse by contract — code and tables carry the content; prose only
appears where a snippet or table can't. Treat `packages/abide/src` as the only
authority for facts and the budgets below as the authority for length. When
either doc and the code disagree, change the doc, not the code.

## Source of truth — non-negotiable

* **`packages/abide/src` is the SOLE source of factual / API truth.** Read it
  before you write. Do not state a behaviour, option, default, path, or
  guarantee you have not seen in that tree. If the code doesn't back it, it
  doesn't go in.
* **`packages/abide/package.json` backs the import paths** — pin every
  `@abide/abide/...` to a real `exports` key — and the footprint claims
  (`dependencies` / `peerDependencies`, `engines`).
* Do **not** mine `examples/`, the current docs, CHANGELOG, or other docs for
  facts. The current README and AGENTS.md are not sources — rebuild each
  completely. (The CHANGELOG may be consulted only to date a rename if one must
  be mentioned.)
* If a claim below no longer matches the code, **change the claim, not the
  code** — the docs reflect what is true today.

## README — four sections, nothing else

Exactly four sections, in this order. The first is the pitch; the next three
are the foundational primitives, each a single artifact with the minimum prose
to read it. The three artifacts form **one story**: §4's component imports the
verb from §2 and the socket from §3. Target ~150 lines, ceiling ~180.

### 1. Intro

* `# abide` (lowercase), then the bold capability line.
* ≤ 2 sentences on what abide is: typed RPCs fan out to HTTP, a CLI, an MCP,
  and an OpenAPI spec from one declaration; the bundler swaps the runtime per
  side. Built for humans *and* machines.
* The footprint bullet(s) true today (zero runtime dependencies; single
  runtime).
* `## Quick start` — two paths: `bunx abide scaffold <name>` (state in a
  trailing comment that it scaffolds, installs, and starts dev only if the
  code still does all three), and the kitchen-sink clone (verify every command
  against `examples/kitchen-sink/package.json` before pasting).

**Do not add**: a comparison / "why not X" section, a stability table, a
maturity essay, adjectives, or any paragraph whose job is to justify adoption.
The artifacts argue; prose doesn't.

### 2. RPCs

* What an RPC is: one export per file under `src/server/rpc/`, the file path is
  the URL, the schema validates args and projects the MCP tool, CLI flags, and
  OpenAPI operation. Standard Schema is the contract (zod / valibot / arktype,
  unadapted).
* One `GET` example (a `getMessages`-style verb with an `inputSchema`).
* The **fan-out diagram** — one declared verb branching to: SSR call
  (`cache(fn)()`), browser fetch (typed proxy), MCP tool, CLI subcommand,
  OpenAPI op. This diagram is the whole premise; keep it.
* The gating note: a schema unlocks the CLI and (for read-only verbs) MCP; a
  mutating verb never auto-exposes to MCP — it needs explicit
  `clients: { mcp: true }`. Note the consume forms (`cache(fn)()` in-process,
  swapped `fetch` in the browser, `.raw(args)`, `.stream(args)`).
* `> ` warning: query args travel as strings — use `z.coerce.*`. The per-verb
  `timeout` (504, every surface) is distinct from `ABIDE_CLIENT_TIMEOUT`.

### 3. Sockets

* What a socket is: one broadcast topic per file under `src/server/sockets/`;
  a `Socket<T>` is an isomorphic `AsyncIterable<T>`; every socket multiplexes
  onto one ws at `/__abide/sockets`.
* One `socket({ schema, tail, ttl })` example.
* The HTTP face: `/__abide/sockets/<name>` — `GET` returns the retained tail,
  `POST` publishes (gated by `clientPublish`).

### 4. Components — the full template

The payoff: **one `.abide` component that imports the §2 verb and §3 socket**
and exercises most of the template grammar in a single realistic page. Keep it
to one snippet. It should show, in order:

* `<script>` — imports (`cache`, `tail`, the rpc verbs and socket via `$server/…`,
  a child component via `$ui/…`), `prop(...)` reads, reactive reads through
  `scope().computed(...)`, local `scope().state(...)`, and an event handler that
  calls a mutating verb.
* a `<template name="…" args={…}>` snippet (reusable builder).
* a `<form>` with `bind:value` / `bind:checked` / `bind:group` and a
  `disabled={…}` button.
* `<template if>`/`<template else>`, `<template switch>`/`case`/`default`,
  `<template await>`/`then`/`catch` wrapping `<template each={…} as="…" key="…">`.
* a component-scoped `<style>`.

Close the file with a single `MIT` line.

## AGENTS.md — the exhaustive surface map

Where the README curates, AGENTS.md is **complete**: every `exports` key
appears exactly once with its import specifier and a one-line spec, so this is
the doc that carries the every-export-accountable contract. Target ~250 lines.
Its skeleton (re-derive the *content* of each from the code; the order is the
editorial layer):

* **Preamble blockquote** — what the file is (the exhaustive map vs. the
  README's 3-primitive intro; CONTEXT.md is the glossary, `docs/adr/` the
  rationale), the no-barrels / namespace-marks-the-side ground rule, the
  package name + runtime (Bun ≥ version from `engines`, zero runtime deps), and
  the import-specifier-vs-file-path note.
* **The premise** — the fan-out diagram + the schema-gating sentence (same
  facts as README §2; AGENTS.md keeps its own copy).
* **File-based conventions** — table (path → meaning) for every bundler-read
  path: `src/server/rpc|sockets/<name>`, prompts, `config.ts`, `app.ts`,
  `bundle/window.ts`, `page.abide`/`layout.abide`, `src/.abide/*.d.ts`,
  `public/`, `dist/`.
* **CLI** — table (command → does) for every `abide <cmd>`; the `bun test`
  preload line.
* **Surface sections, grouped by namespace** — `## Server surface —
  abide/server/*`, `## Isomorphic surface — abide/shared/*`, `## UI surface —
  abide/ui/* (client-only)`, then `## Build / tooling`, `## Desktop bundle`,
  `## MCP`, `## Testing`. Under each, a `### <Title> — @documentation <slug>`
  per slug, and **one bullet per export**: its `abide/...` import specifier +
  a one-line spec of behaviour/options read from the source. Plumbing slugs
  appear too (often condensed to one bullet listing the family, e.g. the
  `ui/dom/*` runtime), labelled `@documentation plumbing`.
* **Generated machine surfaces** — the runtime routes (`/openapi.json`,
  `/__abide/mcp|health|sockets|cli|…`).
* **Environment variables** — table (var → effect) for every `DOCUMENT` env var
  from the inventory.
* **Maintenance footer** — the one-line "mirrors `exports`; run
  `readmeSurfaces.ts` after adding/renaming an export" note.

The accountability gate (below) is what keeps this map honest — every export,
env var, and route the inventory reports must land somewhere here.

## abide-ui idioms — read from `.abide` files, never invent

Read these from real `.abide` files in `examples/`; never write Svelte syntax.

* **Reactive state is reached only through `scope()`**: `scope().state(v)`,
  `scope().computed(fn)` (read-only), `scope().linked(...)`. Bare
  `state`/`computed`/`linked`/`derived` no longer exist and are a compile
  error — a writable computed is expressed at the binding
  (`bind:value={{ get, set }}`). `prop(name)` and `effect(fn)` remain plain
  in-scope functions (no import, no `scope()`). These are functions, **not**
  `$state`/`$derived`.
* Control flow is native `<template>`: `<template if>`/`<template else>`,
  `<template each={…} as="x" key="x">`, `<template await={p}>`/
  `<template then="v">`/`<template catch="e">`, `<template switch>`/`case`/
  `default`. `{expr}` text, `name={expr}` attrs, `onclick={fn}`,
  `bind:value={x}`. Components are capitalised tags filling a `<slot>`;
  `<style>` is component-scoped. Component files end in `.abide`, never
  `.svelte`.

## Validation pass — run before finishing

1. **Import paths** (both docs): every `@abide/abide/...` must be a real
   `exports` key (namespace prefixes ending in `/*` are prose, not imports) —
   fix the doc, not the map.

   ```sh
   grep -ohE '@abide/abide/[a-zA-Z/-]+' packages/abide/README.md packages/abide/AGENTS.md | sort -u
   ```

2. **Surface accountability (AGENTS.md)** — run the inventory; it must exit OK
   (every export carries an `@documentation` tag) and you must point each
   export, each `DOCUMENT` env var, and each `DOCUMENT` route to a line in
   AGENTS.md. Then walk the **change ledger** it prints (every `A`/`D`/changeset
   since the docs were last regenerated, working tree included) and give each a
   disposition — reflected in AGENTS.md, or consciously internal. This is the
   check that catches behaviour changes, not just new export keys.

   ```sh
   bun run packages/abide/scripts/readmeSurfaces.ts
   ```

3. **One story (README)**: the §4 component imports the §2 verb and the §3
   socket — the three artifacts connect, not three disconnected snippets.
4. **Budgets**: README `wc -l` ≤ 180; AGENTS.md ≤ ~260.
5. **Tree / diagram width**: no line in a `text` block over ~76 columns (GitHub
   clips them).

## Write to the right files

Write the canonical, npm-shipped copies under `packages/abide/`:
`packages/abide/README.md` and `packages/abide/AGENTS.md`. The repo-root
`README.md` and `AGENTS.md` are both symlinks to these, so writing the package
copies updates both paths — never write the root paths directly.

## Style

* README title is lowercase `# abide`; AGENTS.md keeps its
  `# AGENTS.md — abide complete surface map` H1. Section headings sentence-case.
* No emojis, no superlatives, no competitor names.
* Right language tag on every fence (`ts`, `sh`, `text`, `toml`,
  `dockerfile`); for `.abide` component snippets use the `html` fence —
  abide-ui templates are valid HTML, so `html` highlights them and there is no
  Svelte anywhere. Filenames and URL paths in backticks.
* Warnings are single `>` lines, not callout paragraphs.
