# abide — CLI Conveniences & App Lifecycle (Spec, Slice 9)

Status: draft, derived from design interview 2026-07-17.
Scope: `abide scaffold` / `run`, and the `src/app.ts` process-lifecycle hooks.
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
   - `package.json` (dep on `abide`; scripts dev/build/start) and `tsconfig.json` (TS7).
     This item once ended "and the `CLAUDE.md` agent pointer (via `init-agent`)". The attribution
     went when CL4 was withdrawn (below), but the claim outlived it by one edit — and with the
     generator gone there is nothing left that could emit that file, so `scaffold()` writes `src/**`,
     `tsconfig.json` and a rewritten `package.json`, and no agent pointer.
3. **Non-interactive by default** — `<name>` is the arg, flags control the rest; no wizard.
4. **Single default starter, no `--template` variant matrix** — one good starting point, small
   surface.

## CL2. `abide run <file> [args…]`

- **Runs a script under the abide server runtime *without serving HTTP*** — boots `config.ts`/
  `env`, app plugins, the wrapped-primitive machinery, then executes the file. For migrations,
  cron tasks, one-off maintenance.
- Server-side APIs work; a wrapped async fn with no request uses the **default ambient context**
  (§2 — the "no request scope" path).
- **Everything after `<file>` is the SCRIPT's**, including anything that looks like an abide flag:
  `abide run migrate.ts --port 5` passes `--port 5` to the migration. `process.argv` is rewritten to
  `[bun, <file>, …args]` for the duration and restored after, so a script reads its arguments where
  any other Bun script would.
- **A throw from the script propagates with its stack** rather than being flattened into an exit
  code — for a failed migration the stack IS the report. Only the wrapper's own failures are coded:
  a missing `<file>` argument or a path that does not exist is stderr + `CLI_EXIT_CODES.usage`.
- It takes the CL3 wrapper contract but **not** `bootApp`: it binds no socket, warms no pages, and
  never enables the log feed (CO1.3) — there would be no route to read it from.

### CL2.1 Exit codes for the `abide` CLI

The development CLI reports the **same** `CLI_EXIT_CODES` table the compiled binary does
(machine-surfaces MS3.4) rather than a second vocabulary. The rule is that **asking for help is a
success and getting the command wrong is not**: a bare `abide`, `-h` or `--help` prints usage to
stdout and exits `0`; an unknown subcommand prints it to **stderr** and exits `usage` (2). These
shared one branch and both exited `0`, which is how `abide biuld` in a CI script printed the usage
text and reported the build succeeded. Also `usage`: `scaffold` with no `<name>`, and `run` with a
missing or nonexistent file. A `check` that finds type errors is `failed` (1) — a real failure, not a
wrong command line — as is a `scaffold` whose `bun install` fails.

## CL3. `src/app.ts` — process-lifecycle hooks

Distinct from the per-request **middleware chain** (C6-nav/S5). `AppModule` carries the
process-lifecycle hooks:

- **`onStart(start)`** — **wraps** the boot. Do setup (open pools, warm shared cache), then
  `await start()` to bind the server. The socket binds **only inside `start()`**, so nothing serves
  until setup finishes (closes the "listening before onStart" race). Returning WITHOUT calling
  `start()` is a **breakout** — the app never boots and `serve()` throws.
- **`onStop(stop)`** — **wraps** graceful shutdown (drain, then `await stop()` to close). Teardown is
  **backstopped**: if the hook returns **or throws** without calling `stop()`, the runtime calls it
  anyway (in a `finally`) so the server never strands as a zombie; a hook that threw then has its
  original error **re-thrown** to the caller (teardown still completed). Same contract under
  `createTestApp`.
- **`onError(error)`** — **request-scoped**; runs when a request throws an unexpected error (a typed
  `error(...)`/`redirect(...)` is a returned Response, not a throw, so it never reaches here). Read
  `request()`/`route()`/`identity()` ambiently. May return a `Response` to shape the client reply;
  anything else (or a throwing hook) falls back to a generic 500 that never leaks the detail. The
  `onError` reply is **finalized like any response** — it still gets the post-dispatch stamping
  (identity cookie / CORS / `traceparent`+`traceresponse`), so an error response is not a
  header-stamping hole. A deferred **identity-resolution failure** (a bearer/cookie that *throws* on
  unseal, AU9) is routed here too, in request scope, rather than escaping as a bare pre-scope 500.
- **`onHealth()`** — **request-scoped** app health hook run on every `GET /__abide/health`; its
  returned fields merge over the framework stub `{ reachable, version, startedAt, uptime }` (app
  fields win). `reachable: false` or a throw → the endpoint answers **503** (CO2.4).

Both `onStart`/`onStop` and `onHealth`/`onError` are async-capable and awaited. `onStart`/`onStop`
live on the process lifecycle; `onHealth`/`onError` are router-consumed (per request).

**Signal-driven shutdown (long-lived `abide dev` / `abide start`).** The CLI installs process handlers
so `onStop` teardown always runs before exit instead of stranding in-flight work — one path, two
triggers: a **signal** (`SIGINT`/`SIGTERM`, e.g. Ctrl-C or a container stop) → graceful teardown, then
`exit 0`; a **crash** (`uncaughtException`/`unhandledRejection`) → teardown, then `exit 1`. A
re-entrancy guard drops a second trigger during teardown, and a **force-exit deadline** (5s) backstops a
hanging `onStop` so shutdown can never itself hang. This is CLI-only: `serve()` — a library entry the
test suite boots repeatedly — does **not** install per-boot process handlers.

The request/nav interceptor is **onion middleware**, not a lifecycle hook: `export const middleware
= [(next) => Response]`. Each entry is `async (next) => { … return await next() }` — `next()` takes
no args (the request comes from `request()`), so the passthrough is `next => next()`. It is
onion-composed with any per-RPC `{ middleware: [...] }` (global wraps per-RPC wraps handler);
short-circuit by returning a `Response`. **Auth is just middleware** — a guard is a middleware that
returns `error(403)` instead of calling `next()`; there is no separate framework gate. Arg/route
checks read the isomorphic `route()` → `{ kind, name, params, url }`.

**Under `abide run`:** `onStart`/`onStop` **run** (the script needs the booted runtime); the
**middleware chain does not** (no requests). So `run` = boot lifecycle without the request path.

---

## Deferred / parked (rule before implementation)

- **`--template` variants** (CL1.4 is single-default) — if ever wanted.
- **Scaffold prompts / interactive mode** (CL1.3 is non-interactive).
- **Cron/scheduling** beyond ad-hoc `abide run` — not in scope.
- **`abide init-agent`** (once CL4) — WITHDRAWN. It was specced as regenerating `CLAUDE.md` from
  the reference source, but no such generator exists: `CLAUDE.md` is written by hand alongside the
  specs, and a command whose whole job is to regenerate it would have to be that generator first.
