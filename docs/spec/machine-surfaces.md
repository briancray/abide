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
   - **A tool call dispatches over the app's OWN HTTP loopback** (`callOwnRpc`), not by invoking
     the rpc callable, **because the args were written by a MODEL and are therefore untrusted.**
     `schemas.input` validation is composed by the **ROUTER** — the validate step ahead of
     `dispatch` — so an in-process call would advertise the declared input schema to the model and
     never enforce what it sent back. That is a bad trade at every surface and a disqualifying one
     here, where the caller is a model and the args are its own output.
     The rpc's own `middleware` is **no longer** half of this argument: since it runs per READ from
     any door (`auth.md` §AU7, "TWO RUNGS"), an in-process call IS authorized. Input validation
     still belongs to the doors that admit caller-supplied args, and a model is one — that is the
     whole of what the loopback still buys. One
     loopback request applies the whole chain verbatim — CSRF, CORS, identity, middleware, input
     validation, the memo, the run deadline, output shaping — with no second copy of any of it. The
     request carries the incoming MCP request's credentials and a CHILD `traceparent`, uses the
     rpc's **DECLARED** method (the router enforces the declaration with a 405, so a hardcoded
     `POST` would leave a `PUT`/`PATCH`/`DELETE` rpc unreachable through this door), and a
     **non-2xx becomes an `HttpError`**. A **streaming** rpc is drained to an array — a model reads
     a VALUE, not a cursor — bounded by the rpc's own progress `timeout` and inventing no second
     bound. `agent()`'s tool surface reaches the same door (MS2.6; `agent.md` AG1.4), because the
     two ARE the same tool set and must not differ on whether the app's own gates run.
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
   the **same middleware chain** as browser/CLI — and since MS2.1 that is true PER TOOL and not only
   of the MCP envelope: the tool call is its own loopback request, so `schemas.input` runs on it, and
   the rpc's own `middleware` runs on it because it runs per READ from every door (`auth.md` §AU7).
   The envelope-only version made "reachability, not
   authorization" a claim about a gate that did not exist on this surface. If you want the MCP
   surface gated, write that
   middleware (bearer via `ABIDE_APP_TOKEN` or a user token → resolve `identity()`, AU6, is the
   convenience path). Whatever authz your middleware enforces applies uniformly across
   browser/MCP/CLI — an unauthorized call fails in middleware, not by being hidden. `clients`
   controls reachability, NOT authorization (DX8).

   **Reachability is nevertheless ENFORCED at DISPATCH, not only at generation.** "Reachability, not
   authorization" says which gate answers an unauthorized caller; it does not license the tool CALL path
   to admit a wider set than the tool LIST advertises. It did: `mcpTools` and `callMcpTool` each spelled
   `clients.mcp === false` for themselves, with nothing tying the two loops together, so drift in one
   direction advertises a tool that answers "unknown tool" and in the other — the one that matters —
   leaves a **withheld rpc reachable that was never advertised**. Both now project through one owner
   (`server/internal/surfaceProjection.ts`: `reaches` / `rpcsFor` / `socketsFor`), which is also what the
   agent surface (MS2.6) and the client bundle read, so a single declaration moves every surface at once.
   The drift test has to CALL a withheld tool: comparing the advertised list against the projection only
   proves the list calls the helper, and passes with a raw-registry dispatch loop reapplied.
   What deliberately does NOT move is the SHAPE each surface renders a read's args in — query parameters
   for OpenAPI, `--flags` for the CLI, a JSON Schema for a model. Folding those together would be a worse
   module than the checks it removed.
6. **Agent tools (DX9).** An agent's `AgentSurface` tool set defaults to **all `clients.mcp`
   RPCs**; `tools: []` = none, `tools: [...]` = a selective subset (see `agent.md` AG2.5). Engine
   built-in tools (bash/file/web) stay **off by default**; app-RPC tools are auto-run and subject
   to whatever authz your middleware enforces — **enforced**, not merely intended, because they
   dispatch over the same loopback door MS2.1 describes (`rpcTools` → `callOwnRpc`). `agent.md`
   AG1.4/AG1.7 owns that half, including what identity the call inherits when there is no enclosing
   request; this section states only that the two surfaces share the one door.

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
   line-streamed stdout. A field's schema `default` renders as `default <value>` in `help`, spelled
   out rather than compressed into the placeholder — `help` has the width for a sentence, and this is
   the column someone reads when deciding whether they need the flag at all.
   - **A type-derived handler's default is its DESTRUCTURING default** (`GET(({ message = 'hello' })
     => …)`), which the type alone cannot carry: `message = 'hello'` widens to `string`, and the only
     thing the inferred type records is that the property became OPTIONAL. The value lives in the AST,
     so `deriveSchema` reads it off the binding pattern into the schema's `default`. Before that, every
     surface describing an rpc — OpenAPI, MCP, `help`, the prompt — said "optional" and none could say
     what you get by omitting it, which is the question anyone actually has at that point.
   - **Literals only, deliberately.** A string, number, `true`, `false` or `null`. A default that is a
     call or a reference (`= Date.now()`, `= FOO`) has no value at derivation time and inventing one
     would be worse than staying silent; a nested pattern (`{ a: { b } }`) has no single name to key
     one on.
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
| `./app logs [--tail n] [--level l] [--debug pat] [--trace id] [--no-follow]` | tail that deployment's log records (`/__abide/logs`, CO1.3) |
| `./app completion <bash\|zsh\|fish>` | print the shell completion script · `completion --line <line>` is the callback it invokes on every TAB — and the same call backs TAB **inside** the REPL, so both surfaces offer identical candidates |
| `serve [--port n]` at the prompt | host it mid-session; commands keep running against it |

Every row above except `exit`/`quit` is answered on **both** surfaces — the command line and the
prompt. That is a declared property, not a coincidence of two ladders happening to agree: see MS3.3.

### As built (MS3.1-3.4)

One staging step (`stageCompileEntry`) writes one generated entry, which calls `runCompiledApp`.
Staging once is what makes `--platforms` cheap: the client build, the AOT-emitted pages and the baked
schema map are target-independent, so a five-platform release pays for them once and only re-runs the
Bun linker per target.

Five decisions the design left open, resolved by the implementation:

1. **Self-hosted mode calls its embedded server over LOOPBACK HTTP, not in-process, and hosts
   LAZILY.** The route callables are right there and calling them directly would be faster — and
   would answer a different question. Going over the wire means identity, the CSRF gate, schema
   validation, the global middleware rung, the
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

   The list grew to **eleven** names, and the argument had to widen with it. `login`/`logout`/
   `identity` are the WHO to `connect`'s WHERE; `logs` is WHAT IT IS DOING; `completion` is how the
   shell asks. None of those four is un-substitutable the way hosting is — an operator can curl
   `/__abide/logs` — so the reason to reserve them is **consistency of vocabulary**, not rescue: a
   reserved list you have to memorise exceptions to is worse than one shadowed rpc, and `identity`
   had already set the precedent.

   `exit`/`quit` forced a second axis. They end a SESSION, which means nothing on a command line, so
   the table carries `where: 'both' | 'prompt'` and they are the only two `'prompt'` entries: an rpc
   named `exit` is still callable as `./app exit` and is merely unreachable from the REPL. The shadow
   warning says which of the two it is, because "shadowed" now names two different losses.

   It is **one table**, holding the name, the `where` and the help text, because four places have to
   agree: the dispatcher (`runCompiledApp`), the REPL (`interactiveCli`), the generated help
   (`cliUsage`) and the warning (`cliCommands`). The last two read it directly, so a name added
   shows up in help and in the warning with no second edit.

   **The guarantee runs BOTH ways, and it did not used to.** The two answering surfaces classify a
   token through `reservedCliCommand(name, where)`, whose `where` split is in the RETURN TYPE and not
   only in the runtime check — asking as `'command'` narrows the answer to the derived
   `CommandSurfaceReserved` (the `'both'` names), so the command line cannot be handed a name it has
   no way to mean and needs no dead `exit` branch; `PromptOnlyReserved` is the complement, and the
   prompt's own loop-control switch is total over it. Both surfaces then dispatch through the ONE
   shared `reservedCliDispatch`, which is **total over `CommandSurfaceReserved`**. So a table entry
   that no surface answers **does not compile**, alongside the direction that already held (a name a
   surface intercepts that is not in the table). The two hand-written ladders it replaced bought only
   the second half, and `completion` was exactly what the missing half lost: declared `'both'`,
   printed by `help`, warned about as shadowing an author's rpc — and answered `unknown command` at
   the prompt. `where` being DERIVED into those two types is what makes the field checked by the type
   system rather than only read at runtime.
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
   a validation failure → **422**. What the 422 projects is the typed-error **ENVELOPE**, not the
   payload alone: `{ status, statusText, message, name: 'ValidationError', data: { issues, fields } }`.
   `ValidationErrorData` is the `data` field — `{ issues, fields }` — and describing it as the whole
   body is the conflation this projection used to publish, which told a generated client to read
   `body.issues` off a body that carries `body.data.issues` (rpc-core §9.1 owns the envelope, §11 the
   payload).
2. **Security schemes documented:** both **bearer** (token) and **cookie** (`abide-identity`)
   auth appear as OpenAPI security schemes.
3. **Gating:** `/openapi.json` is **served by default** and runs through the **middleware
   chain**, so the app can restrict it with middleware (e.g. require auth in prod) or keep it
   public. abide does **not** close it by default — gating is your middleware, not a framework
   default (DX8).
4. **It gates its METHOD**, through the same `enforceMethod` every framework route and every RPC
   route uses: it is read-only, so anything but `GET`/`HEAD` is a **405 + `Allow: GET, HEAD`**
   (`HEAD` is never named — the router derives it from `GET`). The gate had been written out per
   route class inside `dispatch` and simply omitted from three of them, `/openapi.json` among
   them — so a `POST` carrying the abide client's `content-type` cleared the AU8 CSRF gate (which
   exempts nothing about method here) and was answered **200 with the spec document**. A rule
   stated once and applied per call site is a rule the next route class forgets, so it has one
   owner now.

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
- **CLI interactive-mode UX details** — no longer parked; MS3.1 fixed the model and the polish
  followed. At a TTY the REPL now has line editing (cursor, word motions, kill/yank), a 200-entry
  history, TAB completion and inline ghost text; piped, it still reads plain lines and behaves
  identically to before, which is what keeps the two modes one command.

  The completion rule is the load-bearing part: the generated shell script **bakes no names in**. It
  calls `./app completion --line "<line>"` on every TAB, which is the same call the REPL makes, so
  the shell and the prompt cannot offer different candidates and neither goes stale when a handler
  gains a field. Candidates are commands, the reserved names, a command's `--flags` and a field's
  `enum` values — all read from the live input schemas. Completing a command boots nothing.

  Ghost text is dim, INLINE, and never part of the submitted line: the best candidate where one is
  being completed, or at a bare flag position the command's whole signature (`--name <string>
  --loud`, a boolean carrying no placeholder, an enum showing its set). `→`/`ctrl-e` accepts the flag
  alone, not the placeholder. It is suppressed under `NO_COLOR`, where undimmed ghost text would be
  indistinguishable from what the user typed. `--args` is never volunteered — it is on every command,
  so it out-sorted everything anyone was actually reaching for — though it still works spelled out
  and `help` still lists it.
- **Per-user CLI distribution (MS3.5) — NOT built.** `abide compile --platforms` cross-compiles the
  artifacts, but `/__abide/cli` (install script + per-platform tarballs, provisioned with a bearer
  token bound to the fetching user) is a serving surface with its own auth story (AU9 sealed
  tokens), not part of the command. The binary already accepts such a token via `--token` /
  `ABIDE_APP_TOKEN`, so the missing half is issuance + delivery.
