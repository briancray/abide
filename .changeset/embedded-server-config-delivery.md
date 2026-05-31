---
"@briancray/belte": minor
---

Bundles now resolve config from a cwd-independent source instead of relying on Bun's cwd-based `.env` autoload (which a launched `.app`, whose cwd is `/`, silently misses). Config flows entirely through `process.env`, so app code keeps reading `Bun.env.*` and never learns where a value came from.

- The compiled server loads two `.env` layers into `process.env` at boot, before anything reads it: the per-user data dir first (user config), then the binary dir (shipped default). Both back-fill only what a shell export or Bun's CWD `.env` didn't already set, so the precedence is `shell > CWD .env > data-dir .env > binary-dir .env > code default`.
- Add `belte/shared/appDataDir` — the platform-standard per-user data directory keyed by program name, where the data-dir `.env` lives.
- `belte bundle` ships an optional project `.env.bundle` as the binary-dir `.env` (the shipped default layer). Skipped when absent; use a dedicated file, never the working `.env`, since a compiled bundle is extractable.
- Start now races server readiness against the child's exit, so a misconfigured bundle reports the crash immediately instead of stalling for the full readiness timeout.
- A bundle resolves its last connection before the window opens: the launcher records the choice (embedded, or a remote URL) in the data dir, and on relaunch boots/probes it first, opening the window straight at the live server — so the connect screen never flashes. A boot that fails or exceeds a short ceiling, an unconfigured embedded resume, a dead saved server, or no saved choice falls back to opening the connect screen.
- A bundle can declare `config` on its `BundleWindow` as a Standard Schema (the same kind belte accepts for RPC/MCP). Its JSON Schema drives a first-run settings modal on the connect screen — `title` → label, `description` → hint, `format: 'password'` → masked input, `default` → prefill — and answers persist to the data-dir `.env`. An explicit Start (button or File-menu click) always opens the modal prefilled with the last-used values, so re-running Start after a disconnect is how you reconfigure; an auto-start on relaunch never opens the modal — it boots a fully-configured app, or stays on the connect screen when a required key is still unset. Apps with no schema always boot straight through.
