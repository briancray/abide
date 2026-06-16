---
name: write-readme
description: Regenerate the abide README. Use when the user asks to rewrite, update, or refresh the README, or after API changes the README should reflect.
---

# Writing the abide README

The README makes its argument with artifacts — the declare snippet, the
fan-out diagram, the boot surface map — and then gets out of the way. It is
**terse by contract**: code and tables carry the content; prose only appears
where a snippet or table can't. Treat the code as the only authority for
facts; treat the budgets below as the authority for length.

## Source of truth — non-negotiable

* **`packages/abide/src` is the SOLE source of factual / API truth.** Read it
  before you write. Do not state a behaviour, option, default, path, or
  guarantee that you have not seen in that tree. If the code doesn't back it,
  it doesn't go in.
* **`packages/abide/package.json` backs the meta-claims:** import paths (the
  `exports` map — pin every `abide/...` to a real key), dependency
  footprint (`dependencies` / `peerDependencies`), runtime (`engines`).
* Do **not** mine `examples/`, the current README, CHANGELOG, or docs for
  facts. The current README is not a source — rebuild completely. (The
  CHANGELOG may be consulted only to date a rename if one must be mentioned.)
* Never document internal APIs (anything not in the `exports` map).
* If a claim below no longer matches the code, **change the claim, not the
  code** — the README reflects what is true today. That includes structure:
  if a feature in the section plan no longer exists, drop its section; if a
  new public surface exists, add one at the same altitude and budget.

## Run the inventory first — the generative spine

Do not start from a remembered list of surfaces; lists drift. Derive the
surface set from the code every run:

```sh
bun run packages/abide/scripts/readmeSurfaces.ts
```

It reports four things and **fails** if any export is undocumented-by-omission:

1. **exports grouped by `@readme` disposition.** Every `exports` target
   carries a `// @readme <slug>` tag *above its export*, co-located so
   placement can't drift from the code (a renamed/moved export takes its
   disposition with it). The slug names the section the export is documented
   in; `plumbing` means a build/bundler/codegen/test helper that carries no
   prose. **The inventory's printed groups are the section list — don't keep a
   copy of the slugs here.** Some sections are **structural**: no export is
   tagged for them because they describe cross-cutting behaviour or repo shape
   (the body plan marks which). An untagged export is a hard failure — a
   capability with no disposition; add a `// @readme <slug>` line (use
   `plumbing` only if it genuinely carries no user-facing prose), then place
   it at that slug's altitude. A brand-new slug means a new section.
2. **env vars** split `DOCUMENT` vs `internal`. Every `DOCUMENT` row must
   appear in the README (Deploy / Reference / its section).
3. **routes** split the same way; every `DOCUMENT` route must appear.
4. **change ledger** — every source file and changeset added/removed/modified
   since the README was last regenerated (working tree included, so
   uncommitted work counts). This is the only check that catches *behaviour*
   changes, not just new export keys: walk every `A`/`D` line and every
   changeset and give each an explicit disposition — reflected in the README,
   or internal-only. (This is how an `online()`/timeout behaviour change or a
   `createTestClient → createTestApp` rename gets caught.)

When the inventory and a hardcoded claim below disagree, the inventory wins —
fix the claim.

## Verify before you write — the claim ledger

The ledger pins **nuance that can't be derived** (a default, a union type, a
replay rule) to its file. It is deliberately *not* an export list — the
inventory owns enumeration. Never add a row that just names an export; only
add rows for behaviour a reader would get wrong without the note. Re-confirm
each row against its file before writing; if the evidence changed, rewrite or
drop it.

| Claim | Verify against |
| --- | --- |
| One declared rpc = SSR call + browser fetch + MCP tool + CLI subcommand + OpenAPI op | `src/abideResolverPlugin.ts`, `src/lib/shared/createRemoteFunction.ts`, `src/lib/mcp/dispatchMcpRequest.ts`, `src/lib/server/runtime/buildOpenApiSpec.ts` |
| The boot surface map's exact format (three glyph tables, printed by default — silence with `DEBUG=-abide`) | `src/lib/server/runtime/logExposedSurfaces.ts` + `createServer.ts` (`!isDebugNegated('abide')`) — reproduce its real output, never invent columns |
| Mutating verbs never auto-expose to MCP | `src/lib/server/rpc/defineVerb.ts`, `src/lib/shared/resolveClientFlags.ts`, `src/lib/shared/isReadOnlyMethod.ts` |
| Cross-origin browser mutations 403 by default; `crossOrigin: true` opts a verb out; the MCP mount gets the same Origin check | `src/lib/server/runtime/createRouteDispatcher.ts`, `src/lib/server/runtime/isCrossOriginRequest.ts`, `createServer.ts` MCP mount |
| Boot warns when MCP tools are exposed with no `app.handle` | `src/lib/server/runtime/warnUnguardedMcp.ts` + its call in `createServer.ts` |
| SSR snapshots replay GET only; invalidate policies refuse writes at wrap time | `src/lib/shared/REPLAYABLE_METHODS.ts`, `src/lib/shared/cache.ts` (validatePolicy) |
| `cache()` is uniformly `Promise<Return>` — warm SSR/patch values resolve on a microtask (not synchronously), so `.then`/`.catch`/`.finally` chain cleanly; hydration stays flash-free via the resume manifest, not a sync read | `src/lib/shared/cache.ts` (warm path) |
| Query args travel as strings (the `z.coerce` warning) | `src/lib/shared/queryStringFromArgs.ts`, `src/lib/server/rpc/parseArgs.ts` |
| Probes (`pending`/`refreshing`) have their own paths and report-never-act | `src/lib/shared/pending.ts`, `refreshing.ts`, `probeRegistries.ts` |
| The streaming consumer is `tail` (status/error/reconnect semantics) | `src/lib/ui/tail.ts` + the `exports` map |
| In-process calls forward only the header allowlist | `src/lib/shared/forwardHeaders.ts` |
| The testing entry is `createTestApp` (boots the real app in-process); there is no `createTestClient`/`clearVerbRegistry` | `src/lib/test/createTestApp.ts`, `package.json` `exports` (`./test/*`) |
| Single-process deploy truth (`global` cache, socket retention, fan-out are process memory) | `src/lib/shared/globalCacheStore.ts`, socket registry/dispatcher, `Bun.serve` in `createServer.ts` |

The ledger is the floor, not the ceiling — verify every option, default,
helper, env var, and route in the body the same way.

## The opening — a lean banner

The banner is a pitch, not a demo: the proof artifacts (declare snippet,
fan-out diagram, boot map) open the first body phase instead, so the page
leads with the claim and the demonstration lands where the reader starts
reading. Lowercase `# abide`, then in order, nothing else between:

1. The bold capability line: **"Write one function. Get a web app, a CLI, and
   an AI tool — from the same line of code."**
2. As few sentences as carry it (terse cap, not a target) on what abide is
   and that the bundler swaps the runtime per target.
3. One bullet per footprint fact that is true today (today two: zero runtime
   dependencies; one runtime) — add or drop a bullet if the fact set changes,
   don't pad to a fixed count.
4. The quickstart, two paths:
   - **Start a project** — ideally one command (`abide scaffold <name>`).
     State in a trailing comment what it does (scaffolds, installs, starts
     dev) only if the code still does all three.
   - **See everything live** — clone the repo and run the kitchen-sink
     example, which exercises every surface. Verify the commands against
     `examples/kitchen-sink/package.json` before pasting:

     ```sh
     git clone https://github.com/briancray/abide
     cd abide && bun install
     cd examples/kitchen-sink && bun run dev
     ```

**Do not add**: a comparison/"why not X" section, an API stability table, a
scope/maturity essay, adjectives, superlatives, or any paragraph whose job is
to justify adoption. The artifacts argue; prose doesn't.

## The body — the story arc

Budget: target ~400 lines, ceiling ~450 (the phase headers and merged
sections cost a little over the old flat layout). Per concept: **one snippet,
one table, at most one `>` warning line, prose ≤ 2 sentences.** Tables first
for anything enumerable; bullets for one-line rules; prose only for a nuance
neither can hold. Over budget → cut prose, never facts.

The body is a **four-phase story arc**: each phase a `##` with a one-line
intent, each surface a `###` under it. The phase arc and which surface sits in
which phase is the one editorial layer the code can't derive — everything else
comes from the inventory. The table gives each surface its **altitude** only
(snippet / table / budget); read its internal sub-surfaces (which options,
which consume forms) from the code each time, so the plan can't go stale one
level down. *Structural* sections carry no `@readme` export (cross-cutting
behaviour or repo shape). A slug the inventory reports with no row = a new
capability; slot it into the phase its neighbours imply. A merged section
(e.g. Sockets & tail) draws from more than one slug — note both.

**The demonstration leads the first phase, not the banner**: declare snippet →
fan-out diagram → boot surface map (copied from `logExposedSurfaces.ts`'s
actual format — it prints by default, no `DEBUG=abide`) → the one-line gating
note (schema gates the machine surfaces; mutations need explicit
`clients: { mcp: true }`).

| Phase (`##`) | Section (`###`) | From | Altitude & budget |
| --- | --- | --- | --- |
| **Define behaviour once** | rpc | `rpc` | verb-list line + options table (incl. `timeout`) + consume table + one `withJsonSchema` line |
| | Response helpers | `response` | table + one line on shared defaults |
| | Request scope | `request-scope` | table + forward-headers warning |
| **Build the web app** | Pages | `pages` | bullets + `page` snippet |
| | navigate | `navigate` | snippet + ≤ 2 lines |
| | cache | `cache` | snippet (one-shot + `derived()` reactive + `ttl:0`) + options table + `cache.invalidate`/`cache.on` line + nuance bullets |
| | pending / refreshing / online | `probes` | snippet (all three) + ≤ 2 lines |
| | Sockets & tail | `sockets` + `tail` | socket snippet + options table + tail snippet + status/reconnect + SSR no-op |
| | url | `url` | snippet + base-prefix line |
| **Reach it beyond the browser** | CLI | structural | ≤ 2 lines (human + script surface) |
| | MCP & agent | structural + `agent` | MCP mount line + agent snippet + ≤ 2 lines |
| | bundle | `bundle` | ≤ 2 lines (window/menu/`appDataDir`) |
| **Configure, test, ship** | Configuration | `configuration` | typed-env snippet + app-hooks line |
| | Security defaults | structural | bullets (Origin gate + opt-out, MCP same check, boot warning) + `app.handle` snippet + `Host` caveat |
| | Testing | `testing` | `createTestApp` prose + bunfig preload + example |
| | Deploy | structural | single-process truth + the Dockerfile + `PORT`/idle line |
| | Observability | `observability` | grouped: `health()` + `reachable()` + `log`/`trace`, a snippet per cluster |
| | Reference | structural + `reference` | structure (namespace sentence + project tree) + commands table + routes table + env table |
| | (last line) | — | `MIT` |

**Non-derivable nuances to carry** (not in the claim ledger, easy to lose):

* *Reference / structure* — the namespace sentence is about *import*
  namespaces: spell the full `abide/server|ui|shared/*` prefixes
  and name example `shared/*` exports, because `shared/*` is not a project
  directory and the tree must not imply it is. Lead the tree with "A project:";
  tree comments ≤ ~72 cols.
* *rpc* — the `z.coerce` query-args-travel-as-strings warning; the per-verb
  `timeout` (504, server-side) is distinct from `ABIDE_CLIENT_TIMEOUT`
  (client fetch wait).
* *Pages* — the framework resolves only `page.abide` files under
  `src/ui/pages/` as routes (`[id]`/`[...rest]` segments → params). **Layouts
  and error boundaries are userland**: a page imports and wraps its own; the
  framework resolves no `layout.*`/`error.*`, so don't document those as
  conventions. Component files are `.abide` (never `.svelte`), and the boot
  map's pages table is a single `page` column (route only).
* *cache* — the one-shot vs `derived()`-reactive read (`cache.invalidate`
  re-runs the scope) and the `ttl: 0` mutation idiom in the snippet, plus one
  bullet each for the uniform-`Promise` warm read (resolves on a microtask,
  so `.then`/`.catch`/`.finally` work), the top-level-await sweep, and producer
  hoisting.
* *tail* — the SSR no-op (seed with `cache()`, layer `tail()`).
* *Deploy* — the Dockerfile ships the **compiled binary**, never `bun run
  build` + `bun run start`: a multi-stage build that runs `abide compile` in
  an `oven/bun` stage, then `COPY --from=build` the standalone binary into a
  minimal runtime image (e.g. `debian:bookworm-slim`) needing neither Bun nor
  `node_modules`.

## Validation pass — run before finishing

1. **Import paths**: extract every `abide/...` from the README and
   check each against the `exports` map (namespace prefixes ending in `/*`
   are prose, not imports). Example:

   ```sh
   grep -oE '@abide/abide/[a-zA-Z/-]+' packages/abide/README.md | sort -u
   ```

   Every concrete path must be an exports key. Fix the README, not the map.
2. **Surface accountability — re-run the inventory.** Import-path checking
   only proves what's *in* the README is real; it can't catch a surface the
   draft skipped (this is how the `url` helper and `APP_URL` mounting once
   shipped undocumented). The inventory from the top of this skill is the
   gate — re-run it against the finished draft:

   ```sh
   bun run packages/abide/scripts/readmeSurfaces.ts
   ```

   It must exit OK (every export tagged), and you must be able to point each
   **non-plumbing** export, each `DOCUMENT` env var, and each `DOCUMENT`
   route to a place in the README. The disposition lives in the code (the
   `@readme` tag), so there is no allowlist to maintain here: an export that
   should carry no prose is marked `// @readme plumbing` at its source, and a
   new untagged export fails the script. Then walk the **change ledger** one
   more time — every `A`/`D`/changeset since the last README — and confirm
   each is either reflected or consciously internal.
3. **Budget**: `wc -l` ≤ 450.
4. **Tree width**: no line in a `text` tree block over ~76 columns (GitHub
   clips them).
5. **Boot map**: matches the current `logExposedSurfaces.ts` columns exactly,
   and is introduced as default-on (no `DEBUG=abide` prefix).
6. **Phase order**: the four `##` phases appear in arc order, surfaces as
   `###` under them; the demonstration leads the first phase, structure sits
   in Reference.

## Write to the right file

Write to `packages/abide/README.md` — the canonical, npm-shipped file. The
repo-root `README.md` is a symlink to it; never edit the root path or replace
the symlink with a copy.

## Style

* Title lowercase `# abide`; section headings sentence-case, mostly one word.
* No emojis, no superlatives, no competitor names.
* Right language tag on every fence (`ts`, `sh`, `text`, `toml`,
  `dockerfile`); for `.abide` component snippets use the `html` fence — abide-ui
  templates are valid HTML (`<script>` + native `<template if/each/await>` +
  `<style>`, dynamic bits in `{ }`), so `html` highlights them and there is no
  Svelte anywhere. Filenames and URL paths in backticks; component files end in
  `.abide`, never `.svelte`.
* abide-ui idioms (read from `.abide` files, never invent Svelte syntax):
  reactive primitives are `state(v)` / `derived(fn)` / `effect(fn)` / `prop(n)`
  (plain functions, **not** `$state`/`$derived`); control flow is
  `<template if>`/`<template else>`, `<template each={…} as="x" key="x">`,
  `<template await={p}>`/`<template then="v">`/`<template catch="e">`,
  `<template switch>`/`case`/`default`; `{expr}` text, `name={expr}`,
  `onclick={fn}`, `bind:value={x}`; components are capitalised tags filling a
  `<slot>`; `<style>` is component-scoped.
* Warnings are single `>` lines (or a single `>` bullet list in cache), not
  callout paragraphs.
