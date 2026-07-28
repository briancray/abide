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

## MS3. CLI projection (the compiled binary) — **BUILT** (except MS3.5 distribution)

> Naming note: this section says `abide cli` throughout because that is what the design called the
> binary. There is no such COMMAND — `abide compile` builds it (see "Relationship to `abide compile`"
> below), and the command surface is what the executable does by default.

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
3. **Auth:** reaches its server via `connect` / `ABIDE_APP_URL` / `--url` and, if the app's middleware requires it,
   authenticates with a bearer token that resolves `identity()` through the same middleware chain
   — uniform with all surfaces. abide imposes no auth of its own; `clients.cli` is reachability
   only (DX8).
4. **Output convention:** JSON by default (pipeable); errors → stderr + non-zero exit; typed
   errors (§9) → structured stderr shape + distinct exit codes.
5. **Distribution is per-user.** `/__abide/cli` serves an install script + per-platform tarballs
   (`abide compile --platforms` cross-compiles). When an **authenticated user** fetches it, the
   delivered artifact is provisioned with a **bearer token bound to that user** (in the binary's
   config/companion, not the cookie), so the installed CLI authenticates *as them* via the
   middleware chain. Users install the CLI **from the running server**, ready-to-use as themselves.

### Relationship to `abide compile` — RESOLVED: they are the same thing

The spec drew these as two artifacts (a server-only executable and its command-shaped superset).
Built, that distinction did not survive contact: the whole command surface costs **16 KB in a 67 MB
binary** (measured on the docs app), and a server that cannot be asked a question is a strictly worse
server. So there is ONE build and ONE runtime (`runCompiledApp`), under ONE command: `abide compile`. An
`abide cli` command existed briefly as a second name for the identical build and was removed — two
spellings of one action is ceremony, and the name that survives is the one that describes what the
step DOES.

What the executable does is decided at RUN time:

| invocation | behaviour |
| --- | --- |
| `./app` | interactive REPL — **the default** |
| `./app <rpc> [flags]` | that rpc, JSON to stdout |
| `./app serve [--port n]` | host the app in the foreground |
| `./app connect <url>` | remember that deployment until `disconnect` (also at the prompt) |
| `./app disconnect` | forget it and go back to hosting |
| `./app login --token <t>` | remember WHO you are there · `logout` drops it |
| `./app identity` | ask the server who it thinks you are (`/__abide/identity`) |
| `serve [--port n]` at the prompt | host it mid-session; commands keep running against it |

### As built (MS3.1-3.4)

One staging step (`stageCompileEntry`) writes one generated entry, which calls `runCompiledApp`.
Staging once is what makes `--platforms` cheap: the client build, the AOT-emitted pages and the baked
schema map are target-independent, so a five-platform release pays for them once and only re-runs the
Bun linker per target.

Five decisions the design left open, resolved by the implementation:

1. **Self-hosted mode calls its embedded server over LOOPBACK HTTP, not in-process, and hosts
   LAZILY.** The route callables are right there and calling them directly would be faster — and
   would answer a different question. Going over the wire means middleware, identity, the CSRF gate, schema validation, the
   memo and the run deadline all behave exactly as they do for a deployed request, so the CLI is a
   third client of the same face rather than a second implementation of it. `serve()` on port `0`,
   stopped when the command ends — and nothing binds until a call actually needs it, so `--help`, a
   mistyped command, or a session that only reads help never runs the app's `onStart` (`commandTarget`).
2. **Remote mode still reads the command table from the EMBEDDED app.** The URL says where the call
   lands, not what the app is — so `--help`, flag types and validation work with the deployment
   unreachable, and a binary never has to interrogate a server to know how to talk to it.
   **The target is a four-rung ladder** (`resolveCliTarget`), url and token resolved independently:
   `--url`/`--token` (this run) → `ABIDE_APP_URL`/`ABIDE_APP_TOKEN` (this environment) → a stored
   `connect`/`login` (this user, `appDataDir()`, `0600` because it holds bearers) → host it ourselves.
   Flag over env over file is the conventional CLI order and the reason `ABIDE_APP_URL=… ./app` can
   beat a connected binary without disconnecting first; the REPL re-resolves the whole ladder after a
   `connect`/`disconnect` and SAYS where calls go when the file it just wrote is outranked. Storage is
   per-USER rather than per-directory: the binary is installed once and run from anywhere, so a
   cwd-relative dotfile would forget the target the moment you changed directory.
   **WHERE and WHO are separate commands** (`connect`/`disconnect` vs `login`/`logout`) because a
   credential belongs to an ORIGIN — a sealed identity issued by one deployment is meaningless, and
   must not be sent, to another. Credentials are keyed by origin, which is not bookkeeping: when they
   were stored beside the URL, `connect` needed a hand-written rule about when a re-connect keeps the
   token, and keying them correctly deleted the rule. `identity` is named for the framework's own
   word, not `whoami` — `identity()` in a handler, `identity()` in a component, `identity` at the
   command line is one concept with one name (a second spelling would be a second concept).
3. **`serve`, `help`, `connect` and `disconnect` are RESERVED and win over an app rpc of the same
   name** (`RESERVED_CLI_COMMANDS`). The first cut had it the other way — the command namespace belongs to
   the app — and hosting was reachable either way through a `--serve` flag. Dropping that flag settled
   it: with no escape spelling left, an app exporting a `serve` rpc would compile to a binary nobody
   could host, and unlike the rpc (still reachable over HTTP, MCP and the browser) hosting has no
   second door. `connect`/`disconnect` are reserved for the same reason: a binary you cannot re-target
   is as stuck as one you cannot host. A shadowed rpc is still projected into help and warns on `abide:cli`.
   **Global options (`--url`, `--token`, `--pretty`/`--compact`, `-h`) are read only BEFORE the
   subcommand** — after it every flag belongs to the rpc, so a handler may still own a `url` or
   `token` field.
4. **The command surface is the DEFAULT, and the empty case is LOUD.** A bare run opens the REPL,
   which means a container running the binary as its entrypoint with no console would read EOF and
   "succeed" instantly — a clean exit an orchestrator restart-loops on in silence. So a bare run with
   no TTY that never receives a single line of stdin exits `2` naming `serve`. Deployments spell the
   subcommand (`ENTRYPOINT ["server", "serve"]`); this is the cost of giving the zero-arg slot to the
   command surface, paid once, visibly.
5. **Exit codes name the failure CLASS, not the status** (`CLI_EXIT_CODES`): `1` unreachable · `2`
   usage (nothing was sent) · `3` 422 · `4` 401/403 · `5` 404 · `6` 504 · `7` 5xx · `8` other 4xx.
   App-defined typed errors deliberately get no codes of their own — their names are the app's
   vocabulary, not abide's, and a per-name code would mean different things in two apps. The name and
   `data` reach stderr in the structured payload, which is where a script should branch.

## MS4. OpenAPI projection (`/openapi.json`)

1. **OpenAPI 3.1 from the registry.** Each `clients.browser` RPC (MS1.4) → path + operation:
   GET → **one query param per input field** when the schema is field-enumerable (the flat-param
   form, §14.1), else the `__abide_args` JSON-blob param (a type-derived read carries no runtime
   schema, so its fields are unknown to the projection and it falls back to the blob); POST/etc →
   `requestBody`; output schema → `responses`; typed errors (§9) → declared error responses;
   `ValidationErrorData` → 422.
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
  model, not the polish. As built the REPL reads lines (so it behaves the same piped as at a
  terminal) and has no history, completion or line editing.
- **Per-user CLI distribution (MS3.5) — NOT built.** `abide compile --platforms` cross-compiles the
  artifacts, but `/__abide/cli` (install script + per-platform tarballs, provisioned with a bearer
  token bound to the fetching user) is a serving surface with its own auth story (AU9 sealed
  tokens), not part of the command. The binary already accepts such a token via `--token` /
  `ABIDE_APP_TOKEN`, so the missing half is issuance + delivery.
