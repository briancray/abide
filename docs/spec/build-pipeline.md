# abide — Build / Bundling Pipeline (Spec, Slice 8)

Status: draft, derived from design interview 2026-07-17.
Scope: the build/bundling pipeline behind `abide dev`/`build`/`compile` — what produces
`dist/_app`, performs the §6 module-swap, synthesizes client proxies (§8b), code-splits routes
(C6-nav), compiles `.abide` (C1.2), and drives dev watch/reload. Distinct from the *desktop*
bundle (`bundle.md`). Builds on §6, §11, C1, C6-nav.

Through-line: **one pipeline (Bun.build + plugins) for dev and prod** — dev only adds watch +
reload, never a divergent runtime ("consistent runtime between dev and build").

---

## BP1. Foundation & outputs

1. **Built on `Bun.build`** (per "exclusively use Bun APIs") + custom plugins — not
   Vite/esbuild/Rollup.
2. **Asymmetric: client bundled, server run-native.**
   - **Client build** → bundled browser assets (module-swap, code-split, minify, `.abide`→
     client module).
   - **Server** → runs on Bun directly from source (Bun executes TS natively); `.abide`→server-
     module and RPC handlers are loaded/transformed at startup, not browser-bundled.
   - So `abide build` = primarily the **client** bundle.
3. **Content-addressed output dir: `dist/_app/<deterministic-hash>/`** — the hash is a
   deterministic hash of the bundle. Benefits: immutable long-cache static assets, atomic deploy
   swaps, version coexistence (in-flight clients keep resolving their hash), reproducible builds
   (same source → same hash). The **server must know the current hash** to serve the right entry;
   **old hash dirs may linger** for in-flight clients.
4. **Core transforms are Bun.build plugins/passes:**
   - **`.abide` compiler plugin** — `.abide` → client DOM-wiring module / server string-stream
     module (C1.2);
   - **module-swap plugin** — resolves `src/server/**` RPC specifiers → **synthesized client
     proxies** in the client build, strips server runtime (§6); optional `--dump` materializes
     proxies to `src/.abide/` (§8b);
   - **type→JSON-Schema derivation pass** — TypeScript 7 (§11), emits JSON Schema artifacts to
     `src/.abide/`.
5. **Route-based code-splitting** — each `page.abide` / `layout.abide` is a split point → its own
   lazy client chunk, fetched on nav (C6-nav). Default split strategy.
6. **`abide compile` = Bun single-file compile** (`bun build --compile`) → standalone server
   executable; also the base for the CLI's embedded mode (MS3.1).
7. **`compile` and `bundle` embed the client assets** into the executable (Bun asset embedding) —
   the standalone server / desktop binary serves its hashed client assets from **embedded data**,
   no external `dist/_app` needed. Single-file portable.

## BP2. `abide dev`

1. **Same pipeline as `abide build`, plus watch + incremental rebuild + live-reload.** No dev-
   only bundler/runtime — the identical Bun.build + plugins run, just watched. (Consistent-runtime
   goal.)
2. **Reload strategy: fast full page reload, not stateful HMR.** On change, rebuild (Bun is fast)
   and reload the page. State-preserving HMR is a *divergent* runtime (state survives edits in
   ways prod never does), against the consistency goal. **HMR is opportunistic/parked** — adopted
   only if it proves genuinely low-effort; otherwise full-reload stands.
3. **Reload transport = the socket mux** — a **reserved dev-reload channel** on `/__abide/sockets`
   (parallel to the §8 invalidation channel), reusing the WebSocket infrastructure rather than a
   bespoke dev server. The dev-reload and invalidation channels are **reserved internal channels**,
   distinct from the per-`(rpc, args)` authorized cache-coherence channels the mux otherwise carries
   (§8) — they are not keyed per-slot and require no channel join.
4. **Watch:** client-source change → incremental client rebuild → signal reload; **server-source
   change → restart the server process** (or reload the changed module) → signal reload.
   `ABIDE_DEV_SURFACE=1` logs requests under dev.
5. **CSS/Tailwind:** scoped `<style>` compiles into the client build (hashed selectors, C9.1);
   **Tailwind processed only if configured** (optional, C9.1); CSS output lands in
   `dist/_app/<hash>/`.

## BP3. Production serving (implied)

- **`abide start`** runs the built `dist/` (or `ABIDE_APP_DIR` override, default `dist/_app`).
- Static assets from `dist/_app/<hash>/` served **immutable, long-cache** (content-addressed).
- `APP_URL` sets the public app URL → mount base; `PORT` the listen port (existing `ABIDE_*`
  vars).
- **Port resolution** (`serve`, both `dev` and `start`): the requested port is `--port` → `PORT`
  env → **`3000`** default. `abide start` **binds it directly** — a clash surfaces as a hard
  `EADDRINUSE` (production should fail loud, not silently move). `abide dev` treats it as a
  **starting point**: if taken, it **hops upward to the next open port** (scan limit 100, then falls
  back to the OS ephemeral port) so several dev servers coexist. Hand-built configs and
  `createTestApp` pass no port → `0` (ephemeral); only the `serve` CLI applies the `3000`/hop
  resolution.

---

## Deferred / parked (rule before implementation)

- **Stateful HMR** (BP2.2) — only if low-effort; full-reload is the default.
- **Old-hash-dir garbage collection / retention policy** (BP1.3) — lingering is fine; cleanup
  cadence unspecified.
- **Sourcemap strategy** for `.abide` and synthesized proxies (§8b `--dump` exists; full
  sourcemap fidelity across the two-output compile is unspecified).
- **Non-route manual split points** (BP1.5 fixes route-level as default; explicit dynamic-import
  splitting not specced).
