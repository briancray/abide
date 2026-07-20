# abide — Testing (Spec, Slice 10)

Status: draft, derived from design interview 2026-07-17.
Scope: `abide/test/createTestApp` and the app testing story. Builds on §6 (isomorphic call),
§5/§6 (SSR), S1 (sockets), AU3/AU9 (identity/tokens), CO2.4 (health).

Through-line: **test against a real in-process app, not mocks** — same runtime as prod
("consistent runtime between all modes").

---

## TE1. `createTestApp()` → `TestApp`

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
