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
* **Never use `examples/` as a source — not for facts, not for syntax, not for
  idiom.** Examples lag the codebase: they are only re-synced by a separate pass
  (`sync-examples`), so after any grammar change they routinely contain syntax
  the parser has already removed (e.g. a stale `<slot>` / `<template name>`).
  Copying an example is how dead syntax gets laundered into the README and passes
  a token grep. Derive every `.abide` form from the parser/compiler
  (`packages/abide/src/lib/ui/compile`) and prove it by running the README's own
  fences through `compileModule` (the compile gate in the validation pass). The
  ONE permitted touch of `examples/` is reading
  `examples/kitchen-sink/package.json` to confirm the quick-start clone commands —
  a command sanity check, never an API/idiom source. The current README and
  AGENTS.md, the CHANGELOG, and other docs are likewise not sources — rebuild each
  completely. (The CHANGELOG may be consulted only to date a rename if one must
  be mentioned.)
* If a claim below no longer matches the code, **change the claim, not the
  code** — the docs reflect what is true today.

## README — four sections, nothing else

Exactly four sections, in this order. The first is the pitch; the next three
are the foundational primitives, each a single artifact with the minimum prose
to read it. The three artifacts form **one story**: §4's component imports the
RPC from §2 and the socket from §3. Ceiling ~300 lines — §4
carries the growth (it must exercise the whole template grammar); §§1–3 stay lean.

### 1. Intro

* `# abide` (lowercase), then the bold capability line.
* ≤ 2 sentences on what abide is: typed RPCs fan out to HTTP, a CLI, an MCP,
  and an OpenAPI spec from one declaration; the bundler swaps the runtime per
  side. Built for humans *and* machines.
* The footprint bullet(s) true today (the direct-dependency footprint read
  from `package.json` — one dep, TypeScript, at the time of writing; a single
  runtime, Bun).
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
* One `GET` example (a `getMessages`-style RPC with a `schemas.input`). The opts
  shape is the `schemas` namespace — `{ schemas: { input?, output?, files? } }`
  (ADR-0020), NOT a flat `inputSchema`/`outputSchema`/`filesSchema`. Re-confirm
  against `RpcHelper.ts` before writing.
* The **fan-out diagram** — one declared RPC branching to: SSR call (the bare
  call — the smart read, resolved in-process), browser fetch (typed proxy), MCP
  tool, CLI subcommand, OpenAPI op. This diagram is the whole premise; keep it.
* The gating note: a schema unlocks the CLI and (for read-only methods, GET/HEAD)
  MCP; a mutating method (POST/PUT/PATCH/DELETE) never auto-exposes to MCP — it
  needs explicit `clients: { mcp: true }`. Note the consume forms: the **bare call
  `fn(args)` IS the smart read** (cached, coalesced, reactive; isomorphic — same
  callable in-process on the server and swapped to `fetch` in the browser),
  `fn.raw(args, init?)` for the raw `Response`, the mutators/probes
  `fn.refresh()` / `.patch(...)` / `.peek()` / `.pending()` / `.refreshing()` /
  `.error()`, and a streaming handler (`jsonl`/`sse`) makes the bare call return
  a `Subscribable`. (There is no `cache()` wrapper — it was removed; the bare
  call carries the caching.)
* `> ` warning: query/path/form args auto-coerce from the endpoint's typed shape
  (the ADR-0028 build-time coercion plan) — a numeric/boolean/date field arrives
  already typed, so NO `z.coerce` is needed (a value that won't parse stays a
  string so the schema raises an honest 422). The per-RPC `timeout` (504, every
  surface) is distinct from `ABIDE_CLIENT_TIMEOUT`. Confirm against
  `parseArgs.ts` before writing.

### 3. Sockets

* What a socket is: one broadcast topic per file under `src/server/sockets/`;
  a `Socket<T>` is an isomorphic `AsyncIterable<T>`; every socket multiplexes
  onto one ws at `/__abide/sockets`.
* One `socket({ schema, tail, ttl })` example.
* The HTTP face: `/__abide/sockets/<name>` — `GET` returns the retained tail,
  `POST` publishes (gated by `clientPublish`).

### 4. Components

The payoff: **one `.abide` component that imports the §2 RPC and §3 socket**
and exercises the **entire** template grammar in a single coherent page. This is
the one place a reader sees every construct working together (AGENTS.md has the
tables; the README has the live example), so **completeness wins over
minimalism here** — keep it one component and as realistic as you can, but every
construct in the lists below must appear at least once. The list is a drift trap:
**re-derive the full set from the parser** (attribute directives from
`parseTemplate.ts` `readAttributes`; the `{#…}` block keywords — `if`/`for`/
`await`/`switch`/`try`/`snippet` — from `parseTemplate.ts`'s block-keyword switch,
of which `isControlFlow.ts` lists the five *rendered* ones and `snippet` is the
declaration block; the nesting rule from `readElement`), and read the parser's
**removal guards** (`throw new Error('… was removed …')` in `parseTemplate.ts` —
e.g. `<slot>` at the `{children()}` site, `<template name>` / `<template if>` at
`toSnippetOrTemplate`) so you write the current form, not a retired one. Do NOT
copy idiom from `examples/` (they drift). Never trust this prose as the complete
set. It should show:

* `<script>` — imports (the rpc + socket via `$server/…`, a child component via
  `$ui/…`, and the reactive primitives by their own module paths: `state` from
  `abide/ui/state`, `watch` from `abide/ui/watch`, `html` from `abide/ui/html`),
  `props()` destructure reads (ambient — no import), and **every** reactive
  primitive in its current **imported form**: `state` is imported and called
  **bare** (`let count = state(0)`), with its members `state.computed(() => …)`
  (read-only derived) and `state.linked(() => src)` (writable, reseeded from a
  thunk); `watch(source, handler)` is the **single reaction primitive**
  (client-only) — it unified the old author `effect` / `socket.on` / `cache.on`,
  so demo `watch(cell, …)` and `watch(socket, frame => …)`. Do NOT write the
  retired `scope()` destructure-once idiom (`const { state, computed } =
  scope()`) — `scope()` is internal plumbing now, not authored; the primitives
  are resolved by their import binding. `effect` (`abide/ui/effect`) is likewise
  internal plumbing the compiler emits — authors use `watch`, so the README
  should not teach a bare `effect(...)`. A nested branch `<script>` declares its
  own branch-local `state` / `state.computed` the same imported way (re-seeded
  per mount, no module imports). Also show an event handler that calls a mutating
  RPC.
* **every binding / directive**: `{expr}` text, an `html`-branded (unescaped)
  interpolation, `name={expr}` attribute, `on<event>={fn}`, the form binds
  `bind:value` / `bind:checked` / `bind:group`, the derived two-way
  `bind:value={{ get, set }}`, `class:name={cond}`, `style:property={value}`,
  `attach={fn}`, and `{...spread}` — on a component AND on an element.
* **every control-flow block**: `{#if}`/`{:else if}`/`{:else}`/`{/if}`,
  `{#for item, i of list by key}`/`{/for}` AND a `{#for await … of …}` over an
  AsyncIterable, `{#await p}`/`{:then v}`/`{:catch e}`/`{:finally}`/`{/await}`,
  `{#switch}`/`{:case}`/`{:default}`/`{/switch}`,
  `{#try}`/`{:catch}`/`{:finally}`/`{/try}`.
* a `{#snippet name(args)}…{/snippet}` block (reusable builder) called `{name(args)}` — NOT the removed `<template name>` form.
* a capitalised child component that renders its passed content with
  `{children()}` (the `<slot>` element was removed; `{#if children}{children()}
  {:else}…{/if}` is the fallback form — no named slots).
* a root component-scoped `<style>`, AND a `<script>`/`<style>` **nested inside
  one control-flow branch** (scoped to that branch) so the example shows scopes
  nest — the feature AGENTS.md's grammar section describes.

A single page covering all of this runs longer than a curated snippet; that is
expected and allowed (the budget below accounts for it). Close the file with a
single `MIT` line.

## AGENTS.md — the exhaustive surface map

Where the README curates, AGENTS.md is **complete**: every `exports` key
appears exactly once with its import specifier and a one-line spec, so this is
the doc that carries the every-export-accountable contract. It has **no length
ceiling** — make it as long as completeness and clarity require; never merge or
condense sections to hit a line count. Favour one bullet per export (including
plumbing) over family-paragraph shortcuts where the per-export form reads
clearer. Its skeleton (re-derive the *content* of each from the code; the order
is the editorial layer):

* **Preamble blockquote** — what the file is (the exhaustive map vs. the
  README's 3-primitive intro; CONTEXT.md is the glossary, `docs/adr/` the
  rationale), the no-barrels / namespace-marks-the-side ground rule, the
  package name + runtime (Bun ≥ version from `engines`, the direct-dependency
  count from `package.json`), and the import-specifier-vs-file-path note.
* **The premise** — the fan-out diagram + the schema-gating sentence (same
  facts as README §2; AGENTS.md keeps its own copy).
* **File-based conventions** — table (path → meaning) for every bundler-read
  path: `src/server/rpc|sockets/<name>`, `src/mcp/prompts/<name>.md` (Markdown
  prompts, NOT `src/server/prompts/*.ts`), `src/server/config.ts`, `src/app.ts`,
  `src/bundle/window.ts`, `page.abide`/`layout.abide`, `src/.abide/*.d.ts`,
  `src/ui/public/` (static assets — NOT a top-level `public/`), `dist/`. Confirm
  each path against the resolver (`abideResolverPlugin.ts`) — several drifted.
* **CLI** — table (command → does) for every `abide <cmd>`; the `bun test`
  preload line.
* **Authoring contracts** — the shape of the code each convention path holds and
  the contract enforced: the RPC (handler receives
  `InferOutput<schemas.input>`, reads `request()`/`cookies()`, returns
  `json`/`jsonl`/`sse`/`error`/`redirect`/raw `Response`; the `opts` fields incl.
  the `schemas: { input?, output?, files? }` namespace (NOT flat
  `inputSchema`/`filesSchema`; there is NO `outbox` field — removed),
  `clients: { browser, mcp, cli }`, `crossOrigin`, `timeout`, `maxBodySize`; the
  auto-coercion query-arg rule (typed-shape coercion, no `z.coerce`); the consume
  forms — the bare call is the smart read, plus
  `fn.raw(args, init?)`, the `refresh`/`patch`/`peek`/`pending`/`refreshing`/
  `error` members, and a streaming handler making the bare call a `Subscribable`),
  the socket, page/layout (`[id]` → `page.params`, layout outlet,
  `url`/`navigate`), `app.ts`/`config.ts`, and the isomorphism move (the bare
  smart call reads in-process during SSR and bakes its value into the HTML for
  warm hydration — there is no `cache()` wrapper). Read each contract from the
  source types — do not invent.
* **.abide template grammar** — the component file anatomy + the imported
  primitives (`state`, `watch`, `html`, `snippet` — each on its own module path,
  resolved by import binding) alongside the one ambient reader `props()` (no
  import), then tables for reactive state (`state`/`state.computed`/`state.linked`,
  `watch`, `props()`), bindings (`{expr}`,
  `name={expr}`, `on<event>`, `bind:value/checked/group`, `bind:value={{get,set}}`,
  `class:name`, `style:property`, `attach`, `{...spread}`), and control flow — the
  mustache blocks `{#if}`/`{:else if}`/`{:else}`/`{/if}`,
  `{#for item of list by key}`/`{/for}` (`item, i of list`; `{#for await x of …}`),
  `{#await}`/`{:then}`/`{:catch}`/`{:finally}`/`{/await}`,
  `{#switch}`/`{:case}`/`{:default}`/`{/switch}`, `{#try}`/`{:catch}`/`{/try}` —
  and the snippet block `{#snippet name(args)}…{/snippet}` (called `{name(args)}`),
  plus components + the `{children()}` fill point (the `<slot>` element was
  removed — `{children()}` is the single slot, `{#if children}…{/if}` its
  fallback, no named slots). Snippets are a `{#…}` block, NOT `<template>`: the
  `<template name>` snippet form and `<template if>`/`<template each>`/… control
  flow were removed (a bare `<template>` is now just an inert element; using a
  removed form throws a migration error). Note that `<script>` and
  `<style>` are **not component-root-only**: either may sit inside a control-flow
  branch, scoped to that branch's lexical scope (a nested `<script>` declares
  branch-local `state`/`state.computed`/`state.linked`, re-seeded per mount, no
  module imports; a nested `<style>` scopes to its sibling subtree, not the whole
  component) — so write "a root `<style>` is component-scoped", never a bare
  "`<style>` is component-scoped". Re-derive the FULL set from the parser, not
  from this prose, which drifts: the attribute-directive kinds (`event`/`bind`/
  `class`/`style`/`attach`/spread) from `parseTemplate.ts` `readAttributes`, the
  control-flow blocks from `isControlFlow.ts`, the nested-`<script>`/`<style>`
  rule from `readElement` + `analyzeComponent.ts`. Read real `.abide` files for
  syntax, never write Svelte. (CLAUDE.md mandates this section.)
* **Surface sections, grouped by namespace** — `## Server surface —
  abide/server/*`, `## Isomorphic surface — abide/shared/*`, `## UI surface —
  abide/ui/* (client-only)`, then `## Build / tooling`, `## Desktop bundle`,
  `## MCP`, `## Testing`. Under each, a `### <Title> — @documentation <slug>`
  per slug, and **one bullet per export**: its `abide/...` import specifier +
  a one-line spec of behaviour/options read from the source. Plumbing slugs
  appear too — give them one bullet per export (preferred, now there is no
  length ceiling); a condensed family paragraph is a fallback only when the
  per-export form adds nothing. Label them `@documentation plumbing`.
* **Generated machine surfaces** — the runtime routes (`/openapi.json`,
  `/__abide/mcp|health|sockets|cli|…`): every `DOCUMENT` route from the
  inventory, never the internal ones.
* **Environment variables** — table (var → effect) for every `DOCUMENT` env var
  from the inventory.

  > The inventory's `INTERNAL_ENV` / `INTERNAL_ROUTES` sets (in
  > `readmeSurfaces.ts`) are **deliberate plumbing exclusions, not gaps** — do
  > not hand-add them to AGENTS.md (the next regen drops them anyway). If one is
  > genuinely user-facing, the durable fix is removing it from that set in
  > `readmeSurfaces.ts`, not editing AGENTS.md.
* **Maintenance footer** — the one-line "mirrors `exports`; run
  `readmeSurfaces.ts` after adding/renaming an export" note.

The accountability gate (below) is what keeps this map honest — every export,
env var, and route the inventory reports must land somewhere here.

## abide-ui idioms — derive from the parser/compiler, never invent, never copy examples

Derive every `.abide` form from `packages/abide/src/lib/ui/compile` (the parser
and its removal guards) and prove it with the compile gate; never copy from
`examples/` (they drift) and never write Svelte syntax.

* **Reactive state is reached through imported primitives**, resolved by import
  binding (alias-safe) — not through `scope()` (that is internal lowering
  plumbing now, `@documentation plumbing`, never authored). Import `state` from
  `abide/ui/state` and call it **bare** (`let count = state(0)`), using its
  members `state.computed(() => …)` (read-only, lazy, never serialized) and
  `state.linked(() => src, transform?)` (writable, reseeded when the thunk's deps
  change); `state(v, transform?)` is the writable cell whose `transform` gates
  writes. Read/write through `.value`. The retired `scope().state(...)` /
  destructure-once (`const { state, computed } = scope()`) form is **no longer
  recognised** by the compiler — always write the imported-bare form in
  docs/snippets. A writable computed is expressed at the binding,
  `bind:value={{ get, set }}`. `watch` (from `abide/ui/watch`) is the **single
  reaction primitive** — `watch(source, handler)` over a cell, a cell array, a
  socket/stream, or an rpc; it unified the old author `effect` / `socket.on` /
  `cache.on`, and bare `watch(thunk)` is an auto-tracked effect (also the
  compiler's binding form). Client-only, stripped from SSR. `effect`
  (`abide/ui/effect`) still exists but is internal plumbing the compiler emits —
  authors use `watch`, so don't teach a bare `effect(...)`. A nested branch
  `<script>` declares its own branch-local `state`/`state.computed` the same
  imported way. `props()` is the ambient prop reader
  (`const { name = fallback, ...rest } = props()`, no import, no `scope()`).
  These are functions, **not** `$state`/`$derived`.
* Control flow is **mustache blocks**, not `<template>`: `{#if}`/`{:else if}`/
  `{:else}`/`{/if}`, `{#for item of list by key}`/`{/for}` (with `item, i of list`,
  and `{#for await x of source}` over an AsyncIterable), `{#await p}`/`{:then v}`/
  `{:catch e}`/`{:finally}`/`{/await}`, `{#switch}`/`{:case}`/`{:default}`/
  `{/switch}`, `{#try}`/`{:catch}`/`{/try}`. A snippet is its own `{#…}` block,
  `{#snippet name(args)}…{/snippet}` (called `{name(args)}`) — the `<template name>`
  snippet form and all `<template …>` control flow were removed (a bare
  `<template>` is now an inert element). The branch keyword is `{:else if}` (a
  space), not `{:elseif}`. `{expr}`
  text, `name={expr}` attrs, `onclick={fn}`, `bind:value={x}`, plus the directive
  attrs `class:name={cond}`, `style:property={value}`, `attach={fn}`, and
  `{...spread}`. Components are capitalised tags; the content nested in them
  renders where the component calls `{children()}` (no `<slot>` element, no
  named slots). A *root*
  `<style>` is component-scoped, but a `<script>`/`<style>` nested in a
  control-flow branch is scoped to that branch. Component files end in `.abide`,
  never `.svelte`.

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

3. **One story (README)**: the §4 component imports the §2 RPC and the §3
   socket — the three artifacts connect, not three disconnected snippets.
4. **Template coverage (README §4)** — the §4 component must demonstrate every
   grammar construct AGENTS.md tabulates (which is itself re-derived from the
   parser). Grep the README for each; anything `MISSING` is a gap to fill (keep
   this token list in sync with the AGENTS bindings + control-flow tables — the
   parser is the single source for both):

   ```sh
   for t in '{#if' '{:else if' '{:else}' '{/if}' '{#for ' '{#for await' '{/for}' \
     '{#await' '{:then' '{:catch' '{:finally' '{#switch' '{:case' '{:default' \
     '{#try' '{/try}' 'bind:value' 'bind:checked' 'bind:group' 'get, set' \
     'class:' 'style:' 'attach=' '{...' 'ui/state' '= state(' 'state.computed(' \
     'state.linked(' 'watch(' 'html`' '{#snippet ' '{/snippet}' 'children()'; do
     grep -qF -- "$t" packages/abide/README.md || echo "MISSING from README §4: $t"
   done
   ```

   The reactive-primitive tokens enforce the **imported form**: `ui/state` (the
   `state` primitive is imported by its module path) plus the bare callables and
   members (`= state(`, `state.computed(`, `state.linked(`, `watch(`). A README
   that wrote the retired `scope().state(...)` destructure form would now flag
   `ui/state` and the member tokens MISSING — that is the point: teach the
   imported-primitive surface, not the removed `scope()` idiom. The branch keyword
   is `{:else if}` (a space), not `{:elseif}` — re-confirm against
   `parseTemplate.ts` if the parser changes.

5. **Compile gate (authoritative — run this, do not skip)** — extract every
   `html` fence from the README and run each through the REAL `.abide` compiler.
   This is the check the token grep can't be: the grep only confirms a substring
   is *present*, so a fence using REMOVED syntax (`<slot>`, `<template name>`,
   `<template if>`) or a structural mistake (imports after a leading HTML comment,
   a stray nested-script import) passes the grep while throwing here. The compiler
   is the same authority as `packages/abide/src` — if a fence throws, the example
   is teaching syntax that does not exist. Treat a token-grep pass as meaningless
   until this is green.

   ```sh
   bun -e '
   const fs=require("fs");
   const fences=[...fs.readFileSync("packages/abide/README.md","utf8")
     .matchAll(/\x60\x60\x60html\n([\s\S]*?)\x60\x60\x60/g)].map(m=>m[1]);
   const { compileModule }=await import("./packages/abide/src/lib/ui/compile/compileModule.ts");
   let bad=0,i=0;
   for(const s of fences){i++;try{compileModule(s,{filename:`f${i}.abide`})}
     catch(e){bad++;console.log(`fence #${i} THROW →`,String(e.message).split("\n")[0])}}
   console.log(bad?`${bad} fence(s) failed`:`all ${fences.length} .abide fences compile`);
   process.exit(bad?1:0)'
   ```

   (`\x60` is a backtick — written that way so the regex does not close this
   markdown fence.) Every grammar token in step 4 must appear inside a fence that
   ALSO compiles here; a removed-syntax example can satisfy the grep but never the
   compiler. When they disagree, the compiler wins — fix the example.

6. **Budget**: README `wc -l` ≤ ~300 (see the README-sections ceiling above).
   AGENTS.md has no ceiling — length is whatever completeness requires.
7. **Tree / diagram width**: no line in a `text` block over ~76 columns (GitHub
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
