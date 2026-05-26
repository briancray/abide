---
name: write-readme
description: Regenerate or update the project README. Use when the user asks to rewrite, update, or refresh the README, or after API changes the README should reflect.
---

# Writing the belte README

## Read these first

Re-derive the API from source — never trust prior README text. Read at least:

- `packages/belte/package.json` — the `exports` map is the authoritative public surface
- `packages/belte/bin/belte.ts` — CLI commands and flags
- `packages/belte/src/lib/server/index.ts` and `packages/belte/src/lib/browser/index.ts` — what each public umbrella re-exports
- `packages/belte/src/belteResolverPlugin.ts` — directory conventions (`src/pages/`, `src/server/rpc/`, `src/server/sockets/`), path aliases, virtual modules
- `packages/belte/tsconfig.app.json` — the inheritable tsconfig users extend via `"extends": "belte/tsconfig"`
- `examples/barebones/` and `examples/kitchen-sink/` — minimal vs feature-rich snippet sources
- `packages/belte/template/` — what `bunx belte scaffold` produces
- `CLAUDE.md` — current export-grouping + lib-layout conventions

If anything in the README contradicts source, fix the README — not source.

## Section spine

The reference area is flat — every topic is a top-level `##`. No "Reference" wrapper. Internal shape of each section is your call.

In order:

1. **Tagline + TOC table** — single-line tagline immediately followed by a two-column table (`Section` / `What it covers`). One row per `##` section in the rest of the doc. The link column points at the GitHub-style anchor (`[Project layout](#project-layout)`, `[`belte/server`](#belteserver)`). No prose between the tagline and the table — the table *is* the intro orientation.
2. **Bets** — numbered list of the project's foundational decisions.
3. **Examples** — bullets linking to the three example directories.
4. **The four bets** — each bet expanded with a small snippet that proves it.
5. **A complete app on one screen** — a handful of files that compose into a working app (layout, page, an rpc, `package.json`).
6. **CLI** — `bunx belte scaffold`, in-project commands, debug-logging env vars.
7. **File-system conventions** — one `##` per file/folder kind: `Project layout`, `Pages and layouts — src/pages/`, `App hooks — src/app.ts`, `HTML shell — src/app.html`, `Project config`.
8. **Public umbrellas** — one `##` per umbrella, internal `###`s per topic. Currently `belte/server` and `belte/browser`; future siblings (`belte/cli`, `belte/mcp`) slot in here.

Don't add Features / Why belte? / Roadmap / License / badges.

## Scannability rules

The README is a reference, not an essay. Optimise for someone skimming for one answer.

- **Tables first** for anything enumerable: option lists, defaults, verb / content-type / parsing pairs, HTTP cache buckets, file → URL mappings, status states.
- **Bullets next** for short rules that don't fit a table (≤ one line each).
- **Prose last**, in 1–2 sentences only when transition / nuance can't be a table.
- **Snippets are minimal.** One example per concept, trimmed to what proves the point. Don't show barebones + full versions of the same thing in the same section.
- **Place function-shape doc with the declaration**, not the consumer. E.g. `.raw` / `.stream(args?)` lives under RPC because those siblings exist on every rpc function, regardless of who calls it.

## Style

- Sentence-case headings.
- Right language tag on every code block (`ts`, `svelte`, `js`, `json`, `html`, `css`, `sh`).
- Filenames and URL paths in backticks.
- No emojis, no marketing words. State what it does.
- Lift snippets from `examples/` where possible so they're real code that runs.

## After writing

Skim every snippet against source — import paths, function names, types, directory names. If a rename happened recently, the README is the last place to forget.
