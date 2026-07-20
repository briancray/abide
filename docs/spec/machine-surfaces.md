# abide — Machine Surfaces: OpenAPI / MCP / CLI (Spec, Slice 5)

Status: draft, derived from design interview 2026-07-17.
Scope: generation of the three machine artifacts from the app — `/openapi.json`,
`/__abide/mcp`, and the `abide cli` binary. Completes the "humans **and** machines" thesis
(the human side is `docs/spec/abide-compiler.md`). Builds on §13 (multi-client exposure),
§9 (errors), §11 (type-derived schemas), and Slice 3 sockets.

Through-line: **one build-time registry, three projections.** No hand-maintained OpenAPI/MCP
manifests; every surface derives from the same RPC + socket metadata.

---

## MS1. Single registry → three projections

1. **One registry** of RPCs + sockets: name, method, input/output/files schema (explicit or
   type-derived §11), doc-comment, typed-error union (§9), `clients` exposure flags. All three
   surfaces generate from it.
2. **Description source:** the **schema's own `description`/`title` if present, else the
   handler/field doc-comment.** Explicit schema metadata wins; doc-comments fill the gaps.
3. **Type-derived schemas (§11) are first-class in all three** — an RPC with no hand-written
   schema still yields a full OpenAPI operation, MCP `inputSchema`, and CLI arg parser from its
   TS types, with `loud-on-unrepresentable` (§11.3) applied at generation time.
4. **Inclusion gating differs by surface, driven by `clients` (§13.3, default-on all three):**
   - **OpenAPI** = every `clients.browser` RPC (the HTTP/fetch face *is* the browser adapter).
     `browser: false` → omitted from OpenAPI.
   - **MCP** = `clients.mcp` RPCs → tools; `clients.mcp` sockets → tail/publish tools; plus file
     conventions (MS3.4).
   - **CLI** = `clients.cli` RPCs → subcommands.

## MS2. MCP projection (`/__abide/mcp`)

1. **RPC → tool.** name → tool name; single args object (§13.2) → `inputSchema`; description
   per MS1.2; output schema → declared result. **Method → annotation:** GET/HEAD →
   `readOnlyHint: true`; POST/PUT/PATCH/DELETE → mutating (destructive hints as appropriate) so
   clients know read vs write.
2. **Socket → "tail" tool (resolves the parked S4 mapping — tools, not MCP resource-
   subscriptions, since every MCP client supports tools).** MCP tool calls are request/response,
   so the tail tool returns a **snapshot of the socket's current tail buffer** (last-N within
   `ttl`, S2) as a one-shot; the client re-calls to poll. **If** the serving transport is
   streaming-capable (streamable-HTTP/SSE) the tail tool **may stream live** instead of
   snapshotting. Snapshot-poll is the robust baseline.
3. **`clientPublish` socket → a second "publish" tool** (input = message schema), running the
   same validation + handler + auth as any publish (S1/S4).
4. **File conventions map straight through:** `src/mcp/prompts/*.md` → MCP **prompts**
   (`{{placeholder}}` → prompt args); `src/mcp/resources/*` → MCP **resources** (gzip-embedded
   static).
5. **Auth = your middleware, not a framework default.** abide does **not** impose auth on
   machine surfaces. `clients.mcp` controls *reachability/curation* only — it does **not** make a
   tool anonymous-callable or closed-by-default. `/__abide/mcp` is HTTP, so every MCP request runs
   the **same middleware chain** as browser/CLI; if you want the MCP surface gated, write that
   middleware (bearer via `ABIDE_APP_TOKEN` or a user token → resolve `identity()`, AU6, is the
   convenience path). Whatever authz your middleware enforces applies uniformly across
   browser/MCP/CLI — an unauthorized call fails in middleware, not by being hidden. `clients`
   controls reachability, NOT authorization (DX8).
6. **Agent tools (DX9).** An agent's `AgentSurface` tool set defaults to **all `clients.mcp`
   RPCs**; `tools: []` = none, `tools: [...]` = a selective subset (see `agent.md` AG2.5). Engine
   built-in tools (bash/file/web) stay **off by default**; app-RPC tools are auto-run and subject
   to whatever authz your middleware enforces.

## MS3. CLI projection (`abide cli`)

1. **Dual-mode, standalone binary that EMBEDS the full app** (Bun-compiled; the CLAUDE.md word
   "thin" is superseded):
   - **`ABIDE_APP_URL` / `--url` set → remote-client mode** (targets that deployed server).
   - **No URL → boots its own embedded server** and runs against it (self-sufficient/offline).
   - **No subcommand → interactive mode** — a schema-driven command REPL: lists the
     `clients.cli` RPCs, prompts for args from their schemas, prints results, over whichever mode
     (remote or embedded) is active.
2. **Command mapping:** each `clients.cli` RPC → a subcommand; the args object's JSON Schema →
   flags (`--field`, required/optional/types/`--help` from schema + doc-comment); streaming RPC →
   line-streamed stdout.
3. **Auth:** reaches its server via `ABIDE_APP_URL` and, if the app's middleware requires it,
   authenticates with a bearer token that resolves `identity()` through the same middleware chain
   — uniform with all surfaces. abide imposes no auth of its own; `clients.cli` is reachability
   only (DX8).
4. **Output convention:** JSON by default (pipeable); errors → stderr + non-zero exit; typed
   errors (§9) → structured stderr shape + distinct exit codes.
5. **Distribution is per-user.** `/__abide/cli` serves an install script + per-platform tarballs
   (`abide cli --platforms` cross-compiles). When an **authenticated user** fetches it, the
   delivered artifact is provisioned with a **bearer token bound to that user** (in the binary's
   config/companion, not the cookie), so the installed CLI authenticates *as them* via the
   middleware chain. Users install the CLI **from the running server**, ready-to-use as themselves.

### Relationship to `abide compile`

- **`abide compile` = server-only executable** — boots and serves, no subcommands/interactive.
- **`abide cli` = the superset** — embeds the app *and* adds subcommands + interactive +
  remote-client mode. `compile` is "run the server as a binary"; `cli` is "the app as a
  command-line/interactive tool that can also self-host or target remote."

## MS4. OpenAPI projection (`/openapi.json`)

1. **OpenAPI 3.1 from the registry.** Each `clients.browser` RPC (MS1.4) → path + operation:
   GET → query params (encoded args object, §14.1); POST/etc → `requestBody`; output schema →
   `responses`; typed errors (§9) → declared error responses; `ValidationErrorData` → 422.
2. **Security schemes documented:** both **bearer** (token) and **cookie** (`abide-identity`)
   auth appear as OpenAPI security schemes.
3. **Gating:** `/openapi.json` is **served by default** and runs through the **middleware
   chain**, so the app can restrict it with middleware (e.g. require auth in prod) or keep it
   public. abide does **not** close it by default — gating is your middleware, not a framework
   default (DX8).

## MS5. Per-user tokens (forced by MS3.5 — un-parks auth's token model)

Per-user CLI provisioning means the **`ABIDE_APP_TOKEN` model can no longer be a single static
shared secret.** This is a real change to `docs/spec/auth.md` AU6:

- **Mechanism specced in `auth.md` AU9:** a per-user token *is* a sealed identity blob (same
  seal as the `abide-identity` cookie, `ABIDE_IDENTITY_SECRET`), carried as a bearer; issuance =
  seal `identity()` with an `exp` at CLI download; verification = unseal through the hook chain;
  revocation = expiry + `ABIDE_IDENTITY_SECRET` rotation (no denylist).
- `ABIDE_APP_TOKEN` (single shared secret) remains valid for the **single-tenant app-owner**
  case (MS2.5/AU6.1); sealed per-user tokens are the **multi-user** case (AU9.4 ladder).
- **Identity TTL default = 30 days, rolling** (refreshed on activity), configurable via
  `ABIDE_IDENTITY_TTL` (ms); applies to both the `abide-identity` cookie and per-user sealed
  tokens (FD4 — closes AU9.3).

---

## Deferred / parked (rule before implementation)

- **MCP streaming-transport tail** (live vs snapshot-poll, MS2.2) — snapshot-poll is the
  baseline; live streaming depends on serving-transport capability.
- **OpenAPI documentation of the socket HTTP face and streaming (`jsonl`/`sse`) endpoints** —
  MS4 covers RPC operations; streaming/socket HTTP faces in OpenAPI not yet specced.
- **CLI interactive-mode UX details** (history, completion, output formatting) — MS3.1 fixes the
  model, not the polish.
