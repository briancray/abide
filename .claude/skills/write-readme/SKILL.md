---
name: write-readme
description: Regenerate the project README in belte's canonical 4-section format (intro / CLI / project structure with per-file barebones+full snippets / handling data). Use when the user asks to rewrite, update, regenerate, or refresh the README, or after API changes that the README should reflect.
---

# Writing the belte README

This project keeps a fixed README structure. Always preserve it; never invent new top-level sections.

## Before writing

Re-derive the API from source — never trust the previous README's claims. At minimum, read:

- `packages/belte/package.json` — current `exports` map (this is the authoritative public surface)
- `packages/belte/bin/belte.ts` — CLI commands and their flags
- `packages/belte/src/lib/types/AppModule.ts` — what `src/app.ts` can export
- `packages/belte/src/lib/shared/cache.ts` — `cache()` and `cache.invalidate()` semantics
- `packages/belte/src/lib/rpc/handler.ts` — the `handler.<VERB>(fn)` helper signature
- `packages/belte/src/belteResolverPlugin.ts` — path aliases, recognized page leaves under `src/pages/`, rpc files under `src/rpc/`, and the `belte:*` virtual modules
- `packages/belte/src/lib/server/createServer.ts` — cache-control defaults, socket path, default error pages
- `packages/belte/template/` and `examples/scaffold/` — the canonical "barebones" file contents
- `examples/kitchen-sink/` — feature-rich examples to draw "full" snippets from

If anything in the README would contradict source, fix the README — not source.

## Section layout (in order, no others)

### a) Intro

- Tagline: "A tiny SSR + SPA framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev)."
- **Section table** (three columns: `Section` / `Description` / `Link`) — one row per top-level `##` section that follows (CLI, Project structure, Handling data). The link column holds a markdown link to the GitHub-style anchor (e.g. `[#cli](#cli)`). Goes immediately after the tagline, before the four core ideas. Description column is one sentence summarising what's inside.
- **Four core ideas** (numbered list):
  1. Folder-based pages — `src/pages/` for `page.svelte` / `layout.svelte`, folder path becomes the URL. Don't conflate with rpc here; point 4 covers that.
  2. A single Bun process — no Node, no Vite, no separate bundler runtime
  3. Svelte 5 throughout — SSR → hydration, layout chains both sides
  4. RPC is callable from anywhere — one file per remote function under `src/rpc/`, filename = export name = URL (mounted at `/rpc/<file>`), `handler.<VERB>` picks the HTTP verb, bundler runs it in-process on the server and swaps it for a typed `fetch` on the client.
- "It ships as a library (`belte`) plus a CLI (`belte scaffold | dev | build | start | compile`)." — keep the CLI list in sync with `bin/belte.ts`.
- **Examples links** (bulleted): barebones, scaffold, kitchen-sink — one-line description each.

### b) CLI

Two subsections:

1. **Scaffold a new project** — `bunx belte scaffold my-app` flow + a one-paragraph explanation. The command name must match `bin/belte.ts`.
2. **In an existing project** — the four in-project commands (`dev` / `build` / `start` / `compile`) as a code block with one-line trailing comments. Then the `belte compile` defaults paragraph (host target, dist output, embedded gzipped assets).
3. **Debug logging** — `DEBUG=belte:*` and `DEBUG=belte:trace`.

### c) Project structure

- Annotated directory tree showing every file the README covers. Use trailing-space-aligned `#` comments. Include `.env` and `dist/` even though they aren't authored. Show both `src/pages/` and `src/rpc/` with at least one file each.
- Three path-alias lines (`$pages/...`, `$rpc/...`, `$lib/...`) and a short import example.
- One-line preamble that the rest of the section is per-file with barebones + full snippets.
- **One subsection per file**, in this exact order:
  - `src/pages/page.svelte`
  - `src/pages/layout.svelte`
  - `src/rpc/<name>.ts`
  - `src/app.ts`
  - `src/app.html`
  - `src/app.css`
  - `svelte.config.js`
  - `tsconfig.json`
  - `package.json`

Per-file rules:

- 1–3 sentences of prose **before** code. Explain what the file does and why someone reaches for it. Don't restate the obvious.
- **Barebones** snippet — copy the literal contents from `packages/belte/template/` (or `examples/barebones` for `page.svelte`). This must match the on-disk template byte-for-byte; if it doesn't, fix the template, not the snippet.
- **Full** snippet — feature-rich. Pull from `examples/kitchen-sink/` where possible so the snippet is real code that actually runs. Annotate with `/* … */` comments only where the *why* is non-obvious.
- For the `src/rpc/<name>.ts` subsection, document: the `handler.<VERB><Args, Return>(fn)` helper from `belte/rpc/handler`, the content-type-driven argument parsing rules, the one-export-per-file / export-name-matches-filename rule, how the file path becomes the URL (under `/rpc/`), and the bracket-folder convention for path params (`src/rpc/posts/[id]/getPost.ts` → `/rpc/posts/:id/getPost`).
- For `app.ts`, list every optional export with one-line semantics (`init` / `handle` / `handleError` / `socket`) before snippets.
- For `app.html`, list the three SSR markers (`<!--ssr:head-->`, `<!--ssr:body-->`, `<!--ssr:state-->`).

### d) Handling data

**Ordering rule:** introduce remote functions as the primitive first, demonstrate the unwrapped flow (direct calls), and only then layer `cache()` on top. Don't mention `cache()` before the "the layer on top" subsection — readers should see the primitive cleanly before the abstraction.

Subsections, in this exact order:

1. **Intro paragraph** — rpc modules are the data primitive; the bundler runs handlers in-process on the server build and substitutes a `fetch` proxy on the client build. End the paragraph by previewing that `cache()` is a thin layer added on top.
2. **Calling remote functions directly** — `await fn(args)` semantics on each build target, query-string vs JSON-body serialization, the typed `.json()` return, and `fn.url` / `fn.method` for `<form action>` and plain `fetch`.
3. **`cache()` — the layer on top** — what cache buys you over a direct call (dedupe + SSR snapshot + reactivity). Show the minimal `cache(fn)()` wrap.
4. **How a cached request flows** — ASCII flow diagram from browser request through `app.ts handle?` → layout chain → page → cache snapshot serialization → hydration → `$derived` reactivity. Keep it diagram-like, not prose.
5. **Reading data (SSR + first paint)** — top-level await semantics, how SSR-time dedupe works, how hydration replays the snapshot (no second fetch). Include the `experimental: { async: true }` note since belte no longer forces it.
6. **Reactive reads (client)** — `$derived(cache(fn)())` subscribe pattern, `cache.invalidate(fn)` re-runs every subscriber. Show a counter-style example.
7. **Mutations** — call the remote function, then invalidate. List the three `cache.invalidate` overloads (`fn`, `key`, `()`).
8. **`cache` options** — `ttl` (`undefined` / `0` / `>0`) and `key` semantics.
9. **Caching defaults at the HTTP layer** — the cache-control buckets emitted by `cacheControlForAsset.ts` + `createServer.ts`. Build emits everything under `/_app/` with a content hash (entry bundles `client-[hash].js`/`.css` and chunks alike), so the hashed-immutable branch covers the whole built tree; the must-revalidate branch is the fallback for any non-hashed asset. Then SSR HTML/JSON and the error path. Verify the actual strings before pasting numbers.

## Style rules

- Headings use sentence case: `### Scaffold a new project`, not `### Scaffold A New Project`.
- Code blocks use the right language tag (`ts`, `svelte`, `js`, `json`, `html`, `css`, `sh`).
- No emojis.
- No marketing language ("blazing fast", "powerful", etc.). State what it does.
- Reference filenames with backticks (`src/app.ts`), URL paths with backticks (`GET /about`).
- Don't add a "Features" or "Why belte?" or "Roadmap" or "License" section. The README ends after section (d).
- Don't add badges.

## After writing

- Sanity-check every code block compiles in your head against current source — if `belte/cache` got renamed, the snippets must use the new name.
- Verify the example links resolve (the three directories must exist under `examples/`).
- Run `bun x biome check --write --linter-enabled=false README.md` is a no-op (biome doesn't format markdown) — skip the format pass for README.
