# abide — Agent / LLM Surface (Spec, Slice 11)

Status: draft, derived from design interview 2026-07-17.
Scope: `abide/server/agent` — `agent(engine, messages, options?)` → `AgentFrame` stream, and
the `NeutralMessage`/`AgentFrame`/`AgentSurface`/`AgentEngine` types. Serves the "machines" half
of the thesis. Builds on §12 (streaming), §13/MS2 (RPC-as-tool), §13.4/AU7 (authz), C8.3
(`{#for await}`).

Through-line: a **provider-neutral agent loop** that streams normalized frames and can act on
the app's own RPCs as tools — consumed with the same streaming primitives as any §12 stream.

---

## AG1. Core shape

1. **`AgentEngine` = pluggable, provider-neutral LLM backend adapter.** It implements
   `(messages: NeutralMessage[], tools, options)` → `AgentFrame` stream, normalizing its
   provider's streaming + tool-use into `AgentFrame`s. `agent()`'s core is provider-agnostic.
   **Two default engines ship:**
   - **Claude engine** — direct Anthropic API (latest Claude models);
   - **Claude Code engine** — spawns the local `claude` CLI via `Bun.spawn` (bun-native, no npm
     dep; the binary is an optional runtime dependency) and translates its `--output-format
     stream-json` output into `AgentFrame`s. It is **self-contained**: Claude Code runs its OWN
     agentic loop and executes its OWN tools, so the engine emits NO `tool-call` frames (its tool
     activity surfaces as informational `tool-result` frames) and abide's loop settles to `done`
     after one turn. Its built-in tools (bash, file read/edit, web — AG2.5 "engine tools") are OFF
     by default. **Deferred (documented):** exposing the app's own RPCs as tools to the spawned
     Claude Code via abide's MCP face + reconciling its permission model with `ApprovalPolicy`.
   Users implement `AgentEngine` for other providers.
2. **`NeutralMessage` = provider-neutral conversation message** — `role`
   (user/assistant/system/tool) + content parts (text / tool-use / tool-result / image),
   independent of any provider's JSON. It's the `messages` in-format and the accumulated
   transcript.
3. **`AgentFrame` = normalized streaming event taxonomy** (discriminated union), emitted as the
   agent runs: **text delta**, **reasoning/thinking delta**, **tool-call** (model requests a
   tool), **tool-result**, **message start/stop boundaries**, **usage/tokens**, **error**,
   **done**. Provider differences are normalized into these; **thinking and usage frames are
   first-class.**
4. **`AgentSurface` = the tool/capability surface exposed to the agent** — the app's **RPCs
   presented as callable tools** (reusing the MS2 tool schemas: one args object → `inputSchema`,
   §13.2), executed **inside the loop** — the caller never re-drives — so the agent can *act on
   the app*. In-PROCESS, over the app's own **loopback HTTP face** (`callOwnRpc`, the same door
   the MCP tools use), never by invoking the rpc callable: the callable is only the HANDLER, and
   `schemas.input` validation is composed by the ROUTER, so args a MODEL wrote would reach the
   handler unvalidated. (The rpc's own `middleware` used to be the other half of this and no longer
   is — it runs per READ from every door, `auth.md` §AU7 — so what the loopback still buys is input
   validation, which is exactly the gate a model-written arg needs.) This
   is not an implementation detail — it is what makes AG1.7 below true rather than aspirational,
   and the distinction is worth spelling out because "executed in-process" once read as "invoked
   directly", which is how a tool surface whose caller is a model came to run neither gate.
5. **`agent()` runs the full tool-use loop internally** — LLM → tool-call frame → execute tool →
   tool-result frame → LLM continues → … until done — streaming every frame throughout (not
   single-turn; the caller doesn't re-drive).
6. **The frame stream is a normal §12 stream, consumed isomorphically.** A server RPC returns
   `agent(...)` via `sse`/`jsonl`; the browser consumes with `{#for await frame of chat(...)}`
   (C8.3). Chat/agent UIs are built entirely from the streaming primitives already specced — no
   separate agent-UI system.
7. **Agent tool calls run through the app's own middleware as the acting identity** — executing an
   RPC-as-tool goes through the same middleware chain as any request, carrying the current
   `identity()` (§13.4/AU7). abide itself does not authorize tool calls (DX8); the app's middleware
   does. The agent can only do what that identity's middleware allows; no privilege escalation via
   the agent.
   - **The credentials come from the ENCLOSING request scope, and absent one the call goes
     anonymous.** `callOwnRpc` forwards the `authorization`/`cookie` headers of the request the
     `agent()` run happens to sit inside; with no such request — a cron tick, an `onStart` warmer, an
     `abide run` script — it sends neither and the middleware chain sees an anonymous caller. That is
     the fail-closed answer and the reason there is no ambient elevation: an agent driven by nobody
     must not be able to act as a principal nobody presented. An unattended run that legitimately
     needs standing therefore has to be given one explicitly, by the app.

## AG2. Engine contract, tools, lifecycle, approval

1. **`AgentEngine` contract:** `(messages, tools, options)` → `AgentFrame` stream; `options`
   carries model/system/temperature/max-tokens/etc. Normalizing to frames is the engine's job.
2. **Default tool surface = ALL the app's `clients.mcp` RPCs** (enabled or inferred-true, §13.3) —
   the default, not empty and not an explicit opt-in (DX9). Override per call with `{ tools }`:
   `tools: []` = no app tools, `tools: [...]` = a selected subset. Safe because app tools are gated
   by the **app's own middleware** (AG1.7) — availability ≠ authorization. Engine tools are *not*
   in this surface (AG2.5).

   **`clients.mcp` IS the gate, and there is no second one.** An agent's tool set is the MCP tool set
   by definition (MS2.6), so the declaration that admits an rpc to MCP admits it here — one flag, on
   the surface every other machine client already reads. Naming `tools` per call is the OVERRIDE, not
   the way in; a second per-agent inclusion flag would be a second concept for one question.

   **How the default reaches a loop that has no config.** `agent()` is deliberately usable with no app
   at all, so it cannot import the registry — that would drag `buildRegistry` and the whole `router`
   type graph behind every caller, and there would be nothing to read outside a booted app anyway. The
   arrow points the other way: `createApp` PROVIDES a thunk into a leaf
   (`internal/defaultAgentSurface`), and `agent()` only asks. With nothing provided the answer is `[]`
   — the documented no-app behaviour, not a special case. A THUNK because projecting the surface walks
   every route, and a process that never calls `agent()` should not pay for it at boot; the result is
   memoised, since the registry cannot change once the app is built.

   Registration is a **stack**, not a slot. Production serves one app per process, but `createTestApp`
   boots many, and last-one-wins would leave a stopped app answering as the next one's default.
   `provide` returns its own idempotent undo, which `App.stop()` calls.

   `?? ` and not `|| `: an explicit `tools: []` means "no tools", never "give me the default". This
   item read NOT BUILT until the wiring landed — `rpcTools` was correct and orphaned, so the spec
   promised a default that no code path produced (once `docs/TODO.md` #24).
3. **Cancellation:** the frame stream is abortable (§12.5 `AbortSignal`) — aborting stops the
   loop and cancels the in-flight LLM call and any running tool.
4. **Stateless — no built-in transcript persistence.** `agent()` takes `messages`, streams
   frames; the caller accumulates resulting `NeutralMessage`s for the next turn. Conversation
   storage is the app's job (an RPC + the app's store).
5. **Two tool classes, different defaults:**
   - **App tools (`AgentSurface` RPCs)** — **auto-run, gated by the app's middleware** (AG1.7); an
     unauthorized call fails that middleware, not a missing prompt. No approval by default.
   - **Non-app / engine tools** (e.g. the Claude Code engine's bash/file/web) — **OFF by default.**
     They are **not** abide RPCs and **not** gated by the app's middleware — the genuinely
     dangerous surface — so they are **not available unless explicitly enabled**. Off-by-default is
     the posture that closes prompt-injection RCE / secret exfiltration; approval is a *further*
     layer, not the first line of defense.
   - **Approval is a further, options-driven layer once engine tools are enabled.** `options`
     carries an approval policy (per-tool / predicate / "all engine tools"); a tool requiring
     approval makes the loop **surface a tool-call frame and await a decision** (approve/deny/edit)
     instead of auto-running. Most relevant for engine tools, since abide's authz doesn't cover
     them.

---

## Deferred / parked (rule before implementation)

- **Approval decision transport** — how an approve/deny/edit decision flows back into a running
  loop (a paired socket/publish? a resumable stream?) is unspecified; AG2.5 fixes the policy, not
  the wire.
- **Additional default engines** beyond Claude / Claude Code.
- **Engine tool sandboxing/permissions** for the Claude Code engine (its built-ins run outside
  abide authz) — beyond off-by-default (AG2.5) and per-call approval, finer sandboxing is parked.
- **Structured-output / forced-tool modes**, ret/streaming backpressure tuning, cost/usage
  accounting beyond the usage frame.
- **Claude-specific engine mapping** (Anthropic streaming events → frames, model ids) — engine
  implementation detail, not this design spec.
