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
   executable, which is ALSO the CLI's embedded mode (MS3.1): they were specced as two artifacts and
   built as one, so there is one `stageCompileEntry` staging one entry that calls `runCompiledApp`.
   Staging once is what makes `--platforms` pay for the client build, the emitted pages and the baked
   schemas once, and only re-run the Bun linker per target. **BUILT.** The mechanism is one
   idea applied five times: *every lookup `abide start` performs at runtime becomes a build-time
   one*, because on the deploy machine there is no source tree, no `node_modules`, no `dist/`, and
   the executable's own directory (`/$bunfs/root`) is read-only.
   - file discovery (glob + dynamic import) → **static imports** of each rpc/socket/`app.ts`/
     `config.ts` in a GENERATED ENTRY (`dist/compile/entry.ts`), which `bun build --compile`
     bundles. The module objects are read by the same `singleExport`/`isRoute`/`isSocket`/
     `appModuleExports` rules `loadApp` uses, so "what is the RPC in this file" has one definition.
   - `.abide` compiled on first render → the server module **AOT-emitted** beside the entry
     (`emitServerTree`), one per page/layout and per imported component, registered into the same
     cache SSR looks up (`registerEmittedServer`). This is the step that makes a binary possible at
     all: the SSR path compiles a `.abide` by writing a temp module next to abide's runtime and
     importing it, and a binary can do neither.
   - `dist/schemas.json` read at boot → the baked map **inlined** (no tsgo in the binary).
   - boot itself → `runCompiledApp`, whose `serve` path lands in `serveCompiled` and converges on the
     same `serve()` the CLI drives, so port resolution, the `onStart`/`onStop` wrappers, warm pages and
     graceful shutdown are not a second implementation.
   - The entry imports abide as a PACKAGE SPECIFIER (`abide/server/internal/runCompiledApp`), not a
     path resolved from the running CLI: the app's own modules resolve `abide` through its
     `node_modules`, and two copies in one bundle would give the reactive graph, the memo registry
     and the request scope two homes.
7. **`compile` and `bundle` embed the client assets** into the executable (Bun asset embedding) —
   the standalone server / desktop binary serves its hashed client assets from **embedded data**,
   no external `dist/_app` needed. Single-file portable. **BUILT for `compile`**: each chunk *and
   each precompressed sidecar* is embedded separately, so `/__abide/chunk/*` negotiates encodings in
   a binary exactly as it does off disk, and `src/ui/public/**` is embedded keyed by request path
   (`AppConfig.publicFiles`, which replaces the directory walk).
   - **Constraint (inherent, not a gap):** a binary carries no SOURCE tree, so a module that resolves
     or reads paths off `import.meta.dir` finds the read-only `/$bunfs/root`. Two rules follow, and
     the docs app demonstrates both, because its content IS its source:
     - **Read it at first call, not at import.** A top-level `Bun.resolveSync` turns "this one handler
       is unavailable here" into "the app does not boot" (`benchFrontendClient`, whose live bundler
       genuinely cannot run in a binary — its page degrades to its `{:catch}`).
     - **What the binary must still answer for, EMBED at build time.** The docs `snippet` RPC reads
       the demonstrated file off disk; `bun run compile` regenerates `src/server/EMBEDDED_SOURCES.json`
       first and the RPC falls back to it when there is no disk. Disk stays the primary read, so `abide
       dev`/`start` show live edits with no regeneration. With that in place the compiled docs binary
       serves every page byte-identically to `abide start` and passes the whole functional e2e suite.

## BP2. `abide dev`

1. **Same pipeline as `abide build`, plus watch + incremental rebuild + live-reload.** No dev-
   only bundler/runtime — the identical Bun.build + plugins run, just watched. (Consistent-runtime
   goal.)
2. **Reload strategy: fast full page reload, not stateful HMR.** On change, rebuild (Bun is fast)
   and reload the page. State-preserving HMR is a *divergent* runtime (state survives edits in
   ways prod never does), against the consistency goal. **HMR is opportunistic/parked** — adopted
   only if it proves genuinely low-effort; otherwise full-reload stands. The one concession to the
   full reload wiping UI position: the client snapshots window + identified-element scroll into
   `sessionStorage` just before reloading and restores it on the next load (position only — not
   component state, so no runtime divergence).
3. **Reload transport = the socket mux** — a **reserved dev-reload channel** on `/__abide/sockets`
   (parallel to the §8 invalidation channel), reusing the WebSocket infrastructure rather than a
   bespoke dev server. The dev-reload and invalidation channels are **reserved internal channels**,
   distinct from the per-`(rpc, args)` authorized cache-coherence channels the mux otherwise carries
   (§8) — they are not keyed per-slot and require no channel join.
4. **Watch:** client-source change → incremental client rebuild → signal reload; **server-source
   change → restart the server process** (or reload the changed module) → signal reload.
5. **CSS/Tailwind:** scoped `<style>` compiles into the client build (hashed selectors, C9.1);
   **Tailwind processed only if configured** (optional, C9.1); CSS output lands in
   `dist/_app/<hash>/`.

## BP3. Production serving (implied)

- **`abide start`** runs the built `dist/` (client assets under `dist/_app/<hash>/`). The output
  PATH is a build-time choice, not a runtime one — `abide compile --out` names it; there is no env
  override, and the `ABIDE_APP_DIR` one this line used to promise was never implemented.
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
