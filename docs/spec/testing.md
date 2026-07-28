# abide — Testing (Spec, Slice 10)

Status: draft, derived from design interview 2026-07-17.
Scope: `abide/test/createTestApp` and the app testing story. Builds on §6 (isomorphic call),
§5/§6 (SSR), S1 (sockets), AU3/AU9 (identity/tokens), CO2.4 (health).

Through-line: **test against a real in-process app, not mocks** — same runtime as prod
("consistent runtime between all modes").

---

## TE1. `await createTestApp(config?)` → `Promise<TestApp>`

`createTestApp` is **async** (it may scan the filesystem + dynamically import the app's modules);
always `await` it.

1. **Boots a *real* app instance in-process** — an actual `Bun.serve` on an ephemeral port
   (`origin`), running the real pipeline: real RPC dispatch, real SSR, real sockets, real
   middleware chain (FD1). **Not a mocked harness.** Tests hit the same runtime as production.
2. **Handles (`{ origin, fetch, rpc, sockets, health, stop }`):**
   - **`origin`** — the ephemeral base URL.
   - **`rpc`** — the **typed** isomorphic call surface (§6) in-process against the test app;
     `await app.rpc.user({ id: 1 })` is type-checked against the handler.
   - **`sockets`** — subscribe/publish to sockets (`AsyncIterable`, S1).
   - **`fetch`** — raw `fetch` against `origin` for low-level assertions (headers, status, SSR
     HTML).
   - **`health`** — the health probe (CO2.4).
   - **`stop`** — teardown (close server, free port).
3. **Full isolation per call** — each `createTestApp()` has its own port, own per-request/shared
   caches, own state, so parallel tests don't cross-contaminate.
4. **Runs under `bun test`** — abide ships **no** bespoke test runner; `createTestApp` is a
   harness used *within* `bun test`. Unit-testing pure functions is plain `bun test`.
   `createTestApp` is the **integration** harness, not a runner.
5. **Auth in tests = mint a real sealed identity (no backdoor).** `rpc`/`fetch` default to
   **anonymous** (AU3 auto-anonymous). An authenticated caller comes from **`app.as({ id, roles,
   … })`**, which mints a real sealed-identity token (AU9) and issues requests carrying that
   bearer — exercising the **real auth path**, not skipping it.
6. **SSR/render assertions via `fetch`.** `fetch(pagePath)` returns the **real streamed SSR
   HTML** (§5/§6) for string/DOM assertions. abide ships **no** DOM matcher / render DSL — bring
   happy-dom/jsdom for DOM-level queries.
7. **Two modes, chosen by the config shape.** The config's *surface* keys are
   `routes`/`sockets`/`pages`/`layouts`/`middleware` (+ the `*Dirs` helpers).
   - **Explicit** — the config names ≥1 surface → only what is named is registered. A hermetic
     app, no filesystem scan, no lifecycle. (TE1.3 isolation holds per call.)
   - **Discovery** — the config names *no* surface (`createTestApp()`, `createTestApp({})`, or
     only the control knobs) → the whole project at `dir` (default `process.cwd()`) is loaded via
     the same file-based loader `abide start` uses (every `src/server/rpc/**`, socket, page,
     layout, and `src/app.ts` middleware), then booted through its `onStart`/`onStop` **hooks**.
     Integration-test against the real app. **Control knobs** (not surfaces, so setting one alone
     still triggers discovery): `dir` (project root to scan) and `lifecycle` (default `true`; set
     `false` to skip the app's own `onStart`/`onStop` — discovery still runs, and so does the
     framework boot). `lifecycle: false` skips the HOOKS, not the boot: discovery goes through
     `bootApp`, whose contract is `createApp` **plus `warmPages`** and whose teardown backstop runs
     either way, so the AOT page warm is not what the knob turns off. That sharing is the point —
     `bootApp` is the same module `serve()` drives, so a discovery test gets the wrapper order, the
     breakout (an `onStart` that returns without calling `start()`) and the teardown backstop that
     production gets, instead of a second copy of them that can drift. `as(identity)` siblings share
     the one server + teardown, so `onStop` runs exactly once.

---

## Deferred / parked (rule before implementation)

- **First-class render/query helper** (TE1.6 is fetch-HTML + your DOM lib).
- **Client-side (post-hydration) interaction testing** — for **abide's own** testing this is
  done via **Playwright** (the docs-as-e2e-suite, `documentation.md` DOC2.3), *not* `createTestApp`
  (which is server-in-process). Shipping an **app-facing** e2e capability to abide users is
  **parked** — adopt only if it later just makes sense.
- **Time/clock and network mocking** — use `bun test` facilities; not abide-specific.
- **Socket test ergonomics** (waiting for N messages, timeouts) — `sockets` handle exists;
  convenience matchers unspecified.
