---
name: sync-examples
description: After a belte API change, examine the codebase and update every example (and the bundled scaffold template) so they compile and demonstrate the new API. Use when the user changes the public API surface (renames an export, changes a verb helper signature, adds/removes a cache option, restructures routes, etc.) and the examples need to catch up.
---

# Keeping belte examples in sync with the library

The repo's `README.md` is the **source of truth** for what the examples must demonstrate. Treat it as the spec: every helper named in the README has to appear in an example, with the right import path and the right shape. When the API changes, update the README first (`write-readme` skill), then make the examples match.

Four user-facing surfaces must all agree with the README:

1. `packages/belte/template/` — the bundled scaffold (shipped via `bunx belte scaffold`)
2. `examples/scaffold/` — runnable workspace copy of the template
3. `examples/barebones/` — single-page minimum
4. `examples/kitchen-sink/` — comprehensive showcase, structured by the README's lifecycle phases

## Step 1 — read the README first

Open `README.md`. The structure is:

- **Intro + the four bets** — isomorphism, framework owns the network, one runtime, lifecycle-phase exports (the module name is the phase name).
- **A complete app on one screen** — five files. `examples/scaffold` should match this shape (and `examples/barebones` is the even-smaller cut).
- **CLI** — `scaffold | dev | build | start | compile`, plus debug env vars.
- **Reference**, grouped by lifecycle phase (each phase header matches its module path):
  - **Route** — pages/layouts (layouts are nearest-only — deepest wins, replaces ancestors), route modules (`GET / POST / PUT / PATCH / DELETE / HEAD / SOCKET` from `belte/route`), app hooks (`init / handle / handleError`), `app.html`, `app.css`, project config.
  - **Respond** — `request()` and `server` from `belte/server`, `HttpError` from `belte/shared/HttpError`, `belte/respond` helpers (`json`, `error`, `redirect`, `sse`, `jsonl`), HTTP cache-control defaults.
  - **Consume** — direct calls, `cache()` from `belte/consume`, reactive reads + mutations, `.raw`, `.stream(args)` + `subscribe()` from `belte/consume`, `page` + `navigate` from `belte/page`.

Make a mental (or explicit) checklist of every helper named in **Reference**. The kitchen-sink must demonstrate each one; the scaffold + template must have working examples of the bare-minimum subset (one page, one layout, one route, app.ts, app.html, app.css, configs).

## Step 2 — confirm what actually changed

Establish the library-side delta before touching examples. Useful entry points:

- `packages/belte/package.json` `exports` map — the public import surface
- `packages/belte/bin/belte.ts` — CLI command names and flags
- `packages/belte/src/lib/types/` — every published type (`AppModule`, `RemoteFunction`, `SocketFunction`, `RequestStore`, …)
- `packages/belte/src/lib/route/index.ts` — `GET / POST / ... / SOCKET` verb helpers
- `packages/belte/src/lib/respond/` — `json` / `error` / `redirect` / `sse` / `jsonl`
- `packages/belte/src/lib/consume/index.ts` — `cache()` and `subscribe()` re-exports
- `packages/belte/src/lib/client/page.svelte.ts` — `page` + `navigate`
- `packages/belte/src/belteResolverPlugin.ts` — recognised page leaves (`page.svelte`, `layout.svelte` under `src/pages/`), route files (one `.ts` per URL under `src/route/`), path aliases (`$pages`, `$route`, `$lib`), virtual module names

If the change isn't named in the conversation, run `git log -p --stat -n 20 packages/belte/src` to find recent edits — but prefer asking the user when the scope isn't obvious.

## Step 3 — kitchen-sink shape (must mirror README phases)

Kitchen-sink is organised so a reader can move from a passage in the README straight to a working example. The page tree mirrors the three phase names from the Reference, and each sub-page maps to a specific README subsection:

```
src/
  app.ts                          # init + handle + handleError (all three app hooks)
  app.css                         # @import "tailwindcss"
  counterState.ts                 # shared state for the cache demos
  chatState.ts                    # in-memory pub/sub for the SOCKET demos
  sessions.ts                     # request()-driven cookie session store

  pages/
    layout.svelte                 # root nav (Route / Respond / Consume / Auth) + session widget
    page.svelte                   # index linking to each phase

    route/
      page.svelte                 # links to verb-rpcs, socket-rpc, product/[id], auth (nested layout)
      verb-rpcs/page.svelte       # exercises every verb helper
      socket-rpc/page.svelte      # SOCKET declaration explainer (live demo lives in /consume/subscribe)
      product/[id]/page.svelte    # dynamic segment + typed Routes augmentation

    respond/
      page.svelte
      response-helpers/page.svelte    # json / error / redirect
      streaming-helpers/page.svelte   # sse / jsonl via .stream(args)
      request-and-server/page.svelte  # request() reading cookies + server.publish via publishChat
      http-errors/page.svelte         # 404 / 405 / 500 + HttpError catches

    consume/
      page.svelte                     # also demos page + navigate inline
      direct-calls/page.svelte        # typed callable + fn.url for forms / plain fetch
      cache/page.svelte               # counter + invalidate, plus options reference
      raw-escape/page.svelte          # .raw to inspect headers + cache(fn.raw)
      subscribe/page.svelte           # subscribe() against SSE + JSONL + SOCKET

    auth/                             # nested-layout-REPLACES-root showcase + cookie session
      layout.svelte                   # self-contained chrome (replaces the root layout for /auth/*)
      login/page.svelte
      dashboard/page.svelte

  route/
    # one file per URL — filename is export name + URL path (under /route/)
    getEcho.ts createEcho.ts replaceEcho.ts patchEcho.ts deleteEcho.ts headEcho.ts
    redirectExample.ts boom.ts
    tickFeed.ts countLog.ts chatFeed.ts publishChat.ts
    whoAmI.ts
    getCounter.ts incrementCounter.ts resetCounter.ts
    getReport.ts
    getProduct.ts
    getSession.ts login.ts logout.ts
```

Whenever you add or change a kitchen-sink page or route, ask: **which README passage does this map back to?** If a feature in the README has no example, add one. If the kitchen-sink has a demo that isn't in the README, decide whether to add it to the README or drop the demo — drift is the failure mode.

The auth subtree is intentional: `src/pages/auth/layout.svelte` *replaces* the root layout for everything under `/auth` (layouts are nearest-only — deepest wins). The auth layout must be self-contained: its own stylesheet import, its own header chrome, its own session widget. If you change the root layout, the auth layout doesn't inherit anything from it — that's the whole point of this demo.

## Step 4 — scaffold + template

`examples/scaffold/` is the runnable copy of `packages/belte/template/`. Both are "one of every file type with comments". They demonstrate the bare-minimum subset of the README:

- `src/pages/page.svelte` (calls `cache(getHello)()` at top level)
- `src/pages/layout.svelte`
- `src/pages/about/page.svelte` (shows folder-to-URL mapping)
- `src/route/getHello.ts` — uses `GET` from `belte/route` + `json` from `belte/respond`
- `src/app.ts` — all three hooks (`init`, `handle`, `handleError`) so users see what each one looks like
- `src/app.html`
- `src/app.css`
- `svelte.config.js` (async opt-in)
- `tsconfig.json` (with `$pages` / `$route` / `$lib` aliases)
- `package.json`

These two trees must be byte-identical inside `src/`. The legitimate differences are:

- `package.json` — template uses `"belte": "^x.y.z"` (pin to `packages/belte/package.json` `version`); example uses `"belte": "workspace:*"`
- `tsconfig.json` — template is self-contained; example uses `"extends": "../../tsconfig.base.json"`
- `.gitignore` — template ships one; example doesn't need its own

Confirm with:

```sh
diff -ruN packages/belte/template/src examples/scaffold/src
```

(The generated `src/.belte/routes.d.ts` may appear under the example after a build but not under the template — that's fine, it's gitignored.)

## Step 5 — barebones

`examples/barebones/` is the smallest possible app — a single `src/pages/page.svelte` containing `<h1>Hello from belte</h1>` (or the closest equivalent if that helper changes). No layout, no route, no app.ts. If the framework starts requiring more for a minimum app, add it here and update the README to match.

## Step 6 — apply the change

For each affected example, work through:

- **Imports** — if a module path moved (e.g. `belte/consume` → something else), update every `import` across `examples/**` and `packages/belte/template/**`. The three phase modules are `belte/route`, `belte/respond`, `belte/consume`.
- **Response helpers** — handlers should prefer `json` / `error` / `redirect` from `belte/respond` over `Response.json` / hand-rolled `new Response(...)`. The only reason to hand-roll is to set unusual headers (e.g. `Set-Cookie` in `login.ts`).
- **Type signatures** — `GET<Args, Return>(...)`, `SOCKET<Args, Frame>(...)`. If a generic order/name changed, update every call site.
- **`cache()` call sites** — `cache(fn)()` vs `cache(fn, options)()`. If options shape changed, update every site. Same for `subscribe()`.
- **Page / route layout** — pages live under `src/pages/` (folder-based, `page.svelte` + `layout.svelte`, **layouts are nearest-only**). Route modules live under `src/route/` (one `.ts` per URL, filename = export name). If conventions changed, rename + update importers.
- **Route URL prefix** — `fn.url` evaluates to `/route/<filename>`. If a comment or test asserts on URL shape, keep it aligned.
- **CLI scripts** — `package.json` `scripts` use `belte <cmd>`. If a command was renamed, update.
- **Comments inside template/scaffold files** — these are user-facing documentation, not throwaway. If a comment describes behaviour that changed, update the comment.

When in doubt about whether a comment is load-bearing, leave it — but make sure it isn't now wrong.

## Step 7 — verify

For each updated example, run `bun run build` from the example directory and confirm:

- Build exits 0
- Resolver logs show the expected counts ("resolved N route modules", "resolved N socket modules", "resolved N pages", "resolved N layouts" — the route/socket lines only print during server-side bundling, so they may be absent from `belte build` output)
- `dist/_app/` contains a `client.js`, a `client.css` (if any CSS is imported), and `.gz` siblings for each output

For features that only exercise at runtime (SOCKET multiplex, SSE/JSONL streaming, `subscribe()` lifecycle), boot the kitchen-sink with `PORT=<port> bun run start` against a freshly-built `dist/` and curl through the demos. Don't `bun run dev` from a long-running shell — the project's CLAUDE.md prohibits it.

Also exercise the scaffold path itself if `bin/belte.ts`, `src/scaffold.ts`, or `packages/belte/template/` changed:

```sh
rm -rf /tmp/belte-skill-check
bun packages/belte/bin/belte.ts scaffold /tmp/belte-skill-check
ls /tmp/belte-skill-check  # package.json, src/, tsconfig.json, svelte.config.js, .gitignore
rm -rf /tmp/belte-skill-check
```

## Step 8 — README round-trip

If the change is user-visible (new helper export, new file type, new CLI flag, removed feature, renamed module), the README is also out of date. Hand off to `write-readme` to regenerate. After the README updates, **re-run Step 1** — the README is the spec; if the spec moved, the examples likely need another pass.

## Style for any code you write

The repo's CLAUDE.md applies in full. Notable for examples:

- Svelte 5 syntax (`$props`, `$state`, `$derived`, `{@render children()}`)
- `undefined` over `null` for nullish values
- Functional style; prefer `map` / `reduce` over loops
- Tailwind classes when the example already uses Tailwind (kitchen-sink); plain CSS otherwise (template, scaffold, barebones)
- Comments use `/* … */` blocks, not `//` series, when spanning more than one line
- One export per file (route modules must have exactly one; the export name matches the filename)
- Handlers return `Response`s via `belte/respond` helpers when possible; hand-rolled `new Response(...)` only when you need headers/status the helpers don't expose
