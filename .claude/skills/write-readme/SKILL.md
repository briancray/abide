---
name: write-readme
description: Regenerate the belte README. Use when the user asks to rewrite, update, or refresh the README, or after API changes the README should reflect.
---

# Writing the belte README

The README makes its argument with artifacts — the declare snippet, the
fan-out diagram, the boot surface map — and then gets out of the way. It is
**terse by contract**: code and tables carry the content; prose only appears
where a snippet or table can't. Treat the code as the only authority for
facts; treat the budgets below as the authority for length.

## Source of truth — non-negotiable

* **`packages/belte/src` is the SOLE source of factual / API truth.** Read it
  before you write. Do not state a behaviour, option, default, path, or
  guarantee that you have not seen in that tree. If the code doesn't back it,
  it doesn't go in.
* **`packages/belte/package.json` backs the meta-claims:** import paths (the
  `exports` map — pin every `@belte/belte/...` to a real key), dependency
  footprint (`dependencies` / `peerDependencies`), runtime (`engines`).
* Do **not** mine `examples/`, the current README, CHANGELOG, or docs for
  facts. The current README is not a source — rebuild completely. (The
  CHANGELOG may be consulted only to date a rename if one must be mentioned.)
* Never document internal APIs (anything not in the `exports` map).
* If a claim below no longer matches the code, **change the claim, not the
  code** — the README reflects what is true today. That includes structure:
  if a feature in the section plan no longer exists, drop its section; if a
  new public surface exists, add one at the same altitude and budget.

## Verify before you write — the claim ledger

Re-confirm each load-bearing claim against its file before writing. If the
evidence has changed, rewrite or drop the claim.

| Claim | Verify against |
| --- | --- |
| One declared rpc = SSR call + browser fetch + MCP tool + CLI subcommand + OpenAPI op | `src/belteResolverPlugin.ts`, `src/lib/shared/createRemoteFunction.ts`, `src/lib/mcp/dispatchMcpRequest.ts`, `src/lib/server/runtime/buildOpenApiSpec.ts` |
| Zero runtime dependencies; Svelte the only required peer | `package.json` — `dependencies` absent; `peerDependencies` |
| Bun-only (`engines.bun`); Svelte-only web surface | `package.json` `engines`, `src/lib/browser/*` |
| The boot surface map's exact format (three glyph tables under `DEBUG=belte`) | `src/lib/server/runtime/logExposedSurfaces.ts` — reproduce its real output, never invent columns |
| Mutating verbs never auto-expose to MCP | `src/lib/server/rpc/defineVerb.ts`, `src/lib/shared/resolveClientFlags.ts`, `src/lib/shared/isReadOnlyMethod.ts` |
| Cross-origin browser mutations 403 by default; `crossOrigin: true` opts a verb out; the MCP mount gets the same Origin check | `src/lib/server/runtime/createRouteDispatcher.ts`, `src/lib/server/runtime/isCrossOriginRequest.ts`, `createServer.ts` MCP mount |
| Boot warns when MCP tools are exposed with no `app.handle` | `src/lib/server/runtime/warnUnguardedMcp.ts` + its call in `createServer.ts` |
| SSR snapshots replay GET only; invalidate policies refuse writes at wrap time | `src/lib/shared/REPLAYABLE_METHODS.ts`, `src/lib/shared/cache.ts` (validatePolicy) |
| `cache()` returns warm SSR values synchronously (`Promise<Return> \| Return`) | `src/lib/shared/cache.ts` (snapshot warm path) |
| Query args travel as strings (the `z.coerce` warning) | `src/lib/shared/queryStringFromArgs.ts`, `src/lib/server/rpc/parseArgs.ts` |
| Probes (`pending`/`refreshing`) have their own paths and report-never-act | `src/lib/shared/pending.ts`, `refreshing.ts`, `probeRegistries.ts` |
| The streaming consumer is `tail` (status/error/reconnect semantics) | `src/lib/browser/tail.ts` + the `exports` map |
| `scaffold <name>` installs and (interactively) starts dev — one command | `src/scaffold.ts`, `bin/belte.ts` scaffoldCmd |
| In-process calls forward only the header allowlist | `src/lib/shared/forwardHeaders.ts` |
| Single-process deploy truth (`global` cache, socket retention, fan-out are process memory) | `src/lib/shared/globalCacheStore.ts`, socket registry/dispatcher, `Bun.serve` in `createServer.ts` |

The ledger is the floor, not the ceiling — verify every option, default,
helper, env var, and route in the body the same way.

## The opening — reproduce this shape

Lowercase `# belte`, then in order, nothing else between:

1. The bold capability line: **"Write one function. Get a web app, a CLI, and
   an AI tool — from the same line of code."**
2. Two sentences max saying what belte is and that the bundler swaps the
   runtime per target.
3. The declare snippet (one schema-bearing GET, filename-is-identity comment).
4. The ASCII fan-out diagram — one line per surface, each a real consume form.
5. One lead-in line, then the **real** boot surface map (`DEBUG=belte`),
   copied from `logExposedSurfaces.ts`'s actual format.
6. One sentence on gating: schema gates machine surfaces, mutations need
   explicit `clients: { mcp: true }`.
7. Exactly two one-line bullets: zero runtime dependencies; one runtime.
8. The quickstart — ideally a single command. State in a trailing comment
   what it does (scaffolds, installs, starts dev) only if the code still does
   all three.

**Do not add**: a comparison/"why not X" section, an API stability table, a
scope/maturity essay, adjectives, superlatives, or any paragraph whose job is
to justify adoption. The artifacts argue; prose doesn't.

## The body — section plan and budgets

Hard budget: **≤ 400 lines total** (target ~350). Per concept: **one snippet,
one table, at most one `>` warning line, prose ≤ 2 sentences.** Tables first
for anything enumerable; bullets for one-line rules; prose only for a nuance
neither can hold. If the draft exceeds the budget, cut prose — never facts.

Section order (rename/drop/add as the code dictates, keep the altitude):

1. **Layout** — namespace sentence + project tree. The namespace sentence is
   about *import* namespaces: spell the full `@belte/belte/server|browser|shared/*`
   prefixes and name example `shared/*` exports, because `shared/*` is not a
   project directory and the tree that follows must not imply it is. Lead the
   tree with "A project:". Tree comments ≤ ~72 columns; point long lists
   (e.g. app hooks) at Reference instead of inlining them.
2. **rpc** — verbs list, options table (incl. `clients.*` defaults and
   `crossOrigin`), consume table (`fn` / `.raw` / `.stream`), the `z.coerce`
   warning, one `withJsonSchema` line.
3. **Response helpers** — table only, plus one line on shared defaults.
4. **Request scope** — table (`request`/`cookies`/`server`) + the
   forward-headers allowlist warning.
5. **Security defaults** — three bullets (mutation Origin gate + opt-out, MCP
   same check, boot warning) + the `app.handle` auth snippet + one proxy
   `Host` caveat line.
6. **Sockets** — snippet, options table, two lines on publish/iterate/tail.
7. **cache** — snippet (dedupe + the `ttl: 0` mutation idiom), options table,
   `cache.invalidate` line, SSR consumption-form line, then one bullet each
   for the warm-sync union, the top-level-await sweep, and producer hoisting.
8. **pending / refreshing** — snippet + two definition lines.
9. **Pages** — three bullets (routes, nearest-only layouts, error boundary) +
   `page`/`navigate` snippet + two lines.
10. **tail** — snippet + status/error/reconnect in ≤ 4 lines + the SSR no-op
    line (seed with `cache()`, layer `tail()`).
11. **agent** — snippet + two lines (engines are provider packages; frames).
12. **MCP / CLI / bundle** — one three-row table covering all three.
13. **Deploy** — single-process truth in ≤ 3 sentences, the Dockerfile,
    compile targets, `PORT` / idle-timeout line.
14. **Reference** — commands table, framework-routes table, typed-env
    snippet, app-hooks line, testing snippet (`createTestClient` + the
    bunfig preload).
15. `MIT` as the last line.

## Validation pass — run before finishing

1. **Import paths**: extract every `@belte/belte/...` from the README and
   check each against the `exports` map (namespace prefixes ending in `/*`
   are prose, not imports). Example:

   ```sh
   grep -oE '@belte/belte/[a-zA-Z/-]+' packages/belte/README.md | sort -u
   ```

   Every concrete path must be an exports key. Fix the README, not the map.
2. **Surface accountability — the completeness gate.** Import-path checking
   only proves what's *in* the README is real; it can't catch a public
   surface the fixed section plan never had a slot for (this is how the
   `url` helper and `APP_URL` subpath mounting shipped undocumented). So
   enumerate every public surface from the code and account for each member
   — the unit is "consciously placed", not "has its own section":

   ```sh
   # public exports
   grep -oE '"\./[a-zA-Z/-]+":' packages/belte/package.json | tr -d '":'
   # env vars the runtime reads
   grep -rhoE 'Bun\.env\.[A-Z_]+|process\.env\.[A-Z_]+' packages/belte/src | sort -u
   # framework routes
   grep -rhoE '/__belte/[a-z]+|/openapi\.json' packages/belte/src | sort -u
   ```

   Each **exports key** must resolve to exactly one of: (a) documented in a
   section, (b) named in the Layout namespace line (minor shared utils only,
   e.g. `log`), or (c) on the plumbing allowlist below. Each **env var** and
   **route** must appear in the README (Deploy / Reference / a section) *or*
   be internal-only (dev/hot-reload/bundler plumbing — `BELTE_DEV*`,
   `BELTE_PARENT_PID`, `BELTE_SVELTE_MODE`, `BELTE_WEBVIEW_LIB`,
   `/__belte/dev`, `/__belte/reload`, `/__belte/resolve`,
   `/__belte/disconnect`, `/__belte/config`). Anything left unaccounted-for
   is a gap: **an export with no home means a new capability arrived since
   the section plan was written — add a section at the right altitude and
   budget (the source-of-truth rule), don't bury it in the namespace line.**

   **Plumbing allowlist** — build/bundler/codegen exports that carry no
   prose (re-confirm each still belongs; never grow it to silence a real
   surface): `tsconfig`, `build`, `compile`, `preload`, `svelte-plugin`,
   `resolver-plugin`, `browser/remoteProxy`, `browser/socketProxy`,
   `server/AppModule`, `server/rpc/defineVerb`, `server/sockets/defineSocket`,
   `server/prompts/definePrompt`, `server/prompts/renderPromptTemplate`,
   `mcp/createMcpServer`, `test/clearVerbRegistry`,
   `test/createScriptedSurface`, `test/assertAgentFrameConformance`.
3. **Budget**: `wc -l` ≤ 400.
4. **Tree width**: no line in a `text` tree block over ~76 columns (GitHub
   clips them).
5. **Boot map**: matches the current `logExposedSurfaces.ts` columns exactly.

## Write to the right file

Write to `packages/belte/README.md` — the canonical, npm-shipped file. The
repo-root `README.md` is a symlink to it; never edit the root path or replace
the symlink with a copy.

## Style

* Title lowercase `# belte`; section headings sentence-case, mostly one word.
* No emojis, no superlatives, no competitor names.
* Right language tag on every fence (`ts`, `svelte`, `sh`, `text`, `toml`,
  `dockerfile`); filenames and URL paths in backticks.
* Warnings are single `>` lines (or a single `>` bullet list in cache), not
  callout paragraphs.
