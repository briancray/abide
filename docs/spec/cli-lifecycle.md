# abide — CLI Conveniences & App Lifecycle (Spec, Slice 9)

Status: draft, derived from design interview 2026-07-17.
Scope: `abide scaffold` / `run` / `init-agent`, and the `src/app.ts` process-lifecycle hooks.
Thin/mechanical. The request/nav middleware chain is specced in C6-nav/S5; this covers only what's
left. Builds on §2 (ambient context), CO1/CO2, machine-surfaces.md.

---

## CL1. `abide scaffold <name>`

1. **Flow:** create `<name>/` → write starter files → `bun install` (skip `--no-install`) →
   `abide dev` (skip `--no-dev`). Default = one command → running app in the browser. Also
   **`git init`** the new project unless `--no-git`.
2. **Starter = minimal but representative** (demonstrates the isomorphic pattern end-to-end in
   the smallest form; not blank, not kitchen-sink):
   - `src/server/rpc/<something>.ts` — one `GET` RPC with a **type-derived** schema (no hand-
     written schema, to show §11);
   - `src/ui/pages/page.abide` — one page reading it via the async-read seam (`{something()}`,
     C3) to show the isomorphic call;
   - `src/server/config.ts` — an `env(schema)` stub (CO1);
   - `src/app.ts` — an `AppModule` (lifecycle hooks) exporting an empty `middleware` array
     (passthrough `next => next()`);
   - `package.json` (dep on `abide`; scripts dev/build/start), `tsconfig.json` (TS7), and the
     `CLAUDE.md` agent pointer (via `init-agent`).
3. **Non-interactive by default** — `<name>` is the arg, flags control the rest; no wizard.
4. **Single default starter, no `--template` variant matrix** — one good starting point, small
   surface.

## CL2. `abide run <file> [args…]`

- **Runs a script under the abide server runtime *without serving HTTP*** — boots `config.ts`/
  `env`, app plugins, the wrapped-primitive machinery, then executes the file. For migrations,
  cron tasks, one-off maintenance.
- Server-side APIs work; a wrapped async fn with no request uses the **default ambient context**
  (§2 — the "no request scope" path).

## CL3. `src/app.ts` — process-lifecycle hooks

Distinct from the per-request **middleware chain** (C6-nav/S5). `AppModule` carries the
process-lifecycle hooks:

- **`onStart`** — once at server boot (open pools, warm shared cache, register cleanup).
- **`onStop`** — once at graceful shutdown (drain, close).
- **`health()`** — app health hook merged into `/__abide/health` (CO2.4).

The request/nav interceptor is **onion middleware**, not a lifecycle hook: `export const middleware
= [(next) => Response]`. Each entry is `async (next) => { … return await next() }` — `next()` takes
no args (the request comes from `request()`), so the passthrough is `next => next()`. It is
onion-composed with any per-RPC `{ middleware: [...] }` (global wraps per-RPC wraps handler);
short-circuit by returning a `Response`. **Auth is just middleware** — a guard is a middleware that
returns `error(403)` instead of calling `next()`; there is no separate framework gate. Arg/route
checks read the isomorphic `route()` → `{ kind, name, params, url }`.

**Under `abide run`:** `onStart`/`onStop` **run** (the script needs the booted runtime); the
**middleware chain does not** (no requests). So `run` = boot lifecycle without the request path.

## CL4. `abide init-agent`

- **(Re)writes the `CLAUDE.md` agent pointer** — regenerates the file orienting AI agents to
  abide's conventions/APIs. Idempotent refresh. Trivial.

---

## Deferred / parked (rule before implementation)

- **`--template` variants** (CL1.4 is single-default) — if ever wanted.
- **Scaffold prompts / interactive mode** (CL1.3 is non-interactive).
- **Cron/scheduling** beyond ad-hoc `abide run` — not in scope.
