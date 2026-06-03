# Plan: standalone CLI with connect / start / disconnect + interactive session

## Goal

Turn the thin app CLI (`appname`, built by `belte cli`) from a stateless one-shot RPC
caller into a stateful client that mirrors the webview bundle's **connect / start / disconnect**
model, plus an **interactive session** (REPL) that runs commands against the current
connection.

```
appname /connect <url>   connect to a remote belte server → open a session
appname /start           boot a local (embedded) instance → open a session
appname /disconnect      clear the saved connection and exit   (the "reset")
appname                  resume the saved connection → open a session
appname <cmd> [--flags]  one-shot dispatch (scripting), unchanged
```

Inside a session the banner renders once at the top, a status line says
**"Connected to <name> at <url>"** or **"Running a local instance at <url>"**, and the
prompt accepts:

- **bare words** → RPCs (`createPost --title hi`, `tail`), same dispatch as one-shot
- **`/`-prefixed meta** → `/help [cmd]`, `/connect <url>`, `/start`, `/disconnect`, `/clear`, `/exit`

## Decisions settled with the user (do not relitigate)

1. **Always ship the full binary.** `belte cli` co-ships the compiled **server** binary beside
   the CLI binary (per platform), so `start` is always available — no thin-only variant.
   `resolveServerBinary()` finds it next to `process.execPath`, exactly like the bundle.
2. **Session-scoped local server.** `start` spawns the server child for the life of the
   session and kills it on exit. No daemon, no pidfile, no `stop` (future work).
3. **`/`-sigil for the connection verbs, everywhere.** `/connect`, `/start`, `/disconnect`
   are the *only* connection forms — no bare-word aliases (`start`/`disconnect`) and no
   bare-URL alias. So a bare word is always an RPC command and never collides.
4. **Vocabulary is `disconnect`** (the user-facing "reset" == `disconnect`), matching the
   webview bundle.
5. **Reuse bundle idioms** wherever they exist — lift, don't fork.

## Key facts about the current code (verified)

- `src/lib/cli/runCli.ts` — the one-shot driver. load-env → first positional → `--help`
  handling → require `APP_URL` → `parseArgvForRpc` → `createClient({url,token,manifest})` →
  `fn.raw(args)` → stream sse/jsonl frame-by-frame or decode+print once. **The dispatch core
  (parse + client + stream/print) is what the session reuses — extract it.**
- `src/cliEntry.ts` — compiled binary entry; imports `belte:cli-manifest`, `belte:cli-name`,
  `belte:cli-chrome` (banner/footer) virtuals and calls `runCli`.
- `src/lib/cli/createClient.ts` — remote-mode proxy keyed by `url`. **No change** — a
  local instance is just an `APP_URL` pointing at `http://localhost:<port>`; the client
  doesn't care whether the server is remote or a child we spawned.
- `src/lib/cli/loadEnvFromBinaryDir.ts` / `src/lib/shared/loadEnvFromDataDir.ts` /
  `loadEnvFile.ts` — env precedence is **shell > data-dir `.env` > binary-dir `.env`**
  (fill-when-unset). The download bakes `APP_URL`/`APP_TOKEN` into the binary-dir `.env`,
  so a fresh download already dispatches with zero config.
- `src/controlServerWorker.ts` — **the model to mirror.** Already contains, against
  `appDataDir(programName)`:
  - `last-connection.json` = `{ kind: 'embedded' } | { kind: 'url'; url }` with
    `readLastConnection` / `writeLastConnection` / `clearLastConnection` / `lastConnectionPath`
    (currently **module-private — lift to shared so the CLI reuses them**).
  - `startEmbeddedServer(timeoutMs?)` → `killServerChild` + `resolveEmbeddedPort` (findOpenPort)
    + `Bun.spawn([resolveServerBinary()], { env: {...process.env, PORT, BELTE_PARENT_PID} })`
    + race `waitForServer(url)` vs child exit. Holds a module-level `serverChild`.
    **Lift the spawn+wait into a shared helper returning `{ url, child }`** so both the worker
    and the CLI session own their own child.
  - `resolveLaunchTarget()` — embedded→boot, url→probe, none→connect screen; bounded boot.
    **Mirror as `resolveCliTarget()`** (terminal flavour: none → fall back to baked
    `process.env.APP_URL`, then give up to the connect prompt).
  - `handleConnect` probes via `probeBelteServer(url)` (identity `{ name }`) before recording.
    **Reuse `probeBelteServer`** for both the connect step and the status line's app name.
- `src/lib/bundle/{resolveServerBinary,serverBinaryFilename,waitForServer}.ts` and
  `src/lib/server/runtime/findOpenPort.ts` — all reusable as-is.
- `src/buildCli.ts` — two-pass (discovery → compile). Cross-compiles the CLI per platform
  into `dist/cli-thin/<platform>/<programName>`. **Add a per-platform server compile** into
  the same dir as `server`/`server.exe`.
- `src/compile.ts` — produces the standalone server binary, accepts a `target`. **Reuse per
  platform** from `buildCli`.
- `src/lib/server/cli/handleCliDownload.ts` + `createTarGz.ts` — the tarball is
  `[ <programName> binary, .env ]`. `createTarGz` already takes N entries. **Add the
  `server` binary entry.**

## One rule everywhere: `/` manages the connection, a bare word runs a command

The session's `/`-sigil is the form at the top level too, so there is a single teachable rule
in both places. The connection verbs — `/connect <url>`, `/start`, `/disconnect` — are
`/`-prefixed only and **never collide** with an RPC (an RPC name can't start with `/`). There
are no bare-word aliases (`start`/`disconnect`) and no bare-URL alias: a bare first positional
is always an RPC command. The same meta-handler functions back both surfaces (one code path,
not a parallel parser).

First-positional precedence:

```
(none)                              → session (TTY) / printTopLevelHelp (non-TTY)
--help / -h                         → printTopLevelHelp
/connect <url> | /start | /disconnect | /help   → meta handler (never an RPC)
manifest[first] (or unknown)        → one-shot RPC dispatch (errors if unknown)
```

A bare `start` / `disconnect` / `http://…` is not special-cased — it routes to one-shot
dispatch like any other word, erroring as an unknown command. The `/` form is the only way to
manage the connection, which keeps the rule uniform and collision-free.

## Architecture

```
appname (compiled CLI binary)
  ├─ load env (binary-dir .env → data-dir .env → shell)   [unchanged precedence]
  ├─ first positional (`/`-meta verbs only; every bare word is an RPC):
  │    --help / -h            → printTopLevelHelp
  │    /connect <url>         → connect: probeBelteServer → writeLastConnection{url} → runSession
  │    /start                 → startLocalInstance (session-scoped child) →
  │    |                         writeLastConnection{embedded} → runSession
  │    /disconnect            → clearLastConnection → print, exit
  │    <cmd> [--flags]        → resolveCliTarget → dispatchCommand (one-shot) [scripting]
  │    (none) + TTY           → runSession (resume via resolveCliTarget)
  │    (none) + non-TTY       → printTopLevelHelp
  └─ runSession(target):
        print banner once; print status line (probe identity name)
        loop: read line →
          ''            → reprompt
          /help [cmd]   → printTopLevelHelp / printCommandHelp
          /connect <u>  → probe → swap target → writeLastConnection{url}  → reprint status
          /start        → startLocalInstance → swap target → writeLastConnection{embedded}
          /disconnect   → kill child if local → clearLastConnection → reprint "(not connected)"
          /clear        → clear screen
          /exit /quit   → break
          <tokens>      → dispatchCommand(first, rest)   (same parse/stream/print as one-shot)
        on break/EOF/SIGINT: kill child if any; print footer; exit 0
```

`target` is `{ url: string; child?: Bun.Subprocess; appToken?: string }`. The session owns the
child and kills it when the connection is swapped or the session ends.

## File-by-file work

### 1. Lift shared persistence out of the worker (dedup, enables reuse)

New, in `lib/shared/` (one export each), moved verbatim from `controlServerWorker.ts`:

- `lib/shared/types/LastConnection.ts` — `type LastConnection = { kind:'embedded' } | { kind:'url'; url:string }`
- `lib/shared/lastConnectionPath.ts` — `join(appDataDir(programName), 'last-connection.json')`
- `lib/shared/readLastConnection.ts` / `writeLastConnection.ts` / `clearLastConnection.ts`

Then **edit `controlServerWorker.ts`** to import these instead of its private copies (no
behaviour change — it currently passes `programName` implicitly via module state; the lifted
fns take `programName` as an arg).

### 2. Lift the embedded-server spawn (dedup)

`lib/bundle/startEmbeddedServer.ts` (NEW) — pure-ish helper returning `{ url, child }`:
spawn `resolveServerBinary()` with `PORT` (from `findOpenPort`) + `BELTE_PARENT_PID`, race
`waitForServer(url)` vs `child.exited`, throw on early exit. Lifted from the worker's inline
`startEmbeddedServer`. **Edit `controlServerWorker.ts`** to call it (keeping its own
`serverChild` = the returned `child`, and its `killServerChild`).

### 3. CLI dispatch core extraction

`lib/cli/dispatchCommand.ts` (NEW) — the body of `runCli`'s dispatch, signature:
`dispatchCommand({ programName, manifest, command, argvTail, url, token }): Promise<number>`.
Does `parseArgvForRpc` → `createClient` → `fn.raw` → stream-or-decode → `printValue`. Returns
an exit code. **Edit `runCli.ts`** to call it for the one-shot path (keeps `--help` handling,
target resolution, and the unknown-command message in `runCli`).

`printValue` moves alongside (or into `lib/cli/printValue.ts`) so both paths share it.

### 4. Target resolution for the terminal

`lib/cli/resolveCliTarget.ts` (NEW) — mirror `resolveLaunchTarget`:

```
read last-connection.json:
  { kind:'embedded' }  → startLocalInstance() → { url, child }
  { kind:'url', url }  → probeBelteServer(url) alive ? { url } : (warn 'lost', undefined)
  none                 → process.env.APP_URL ? { url: APP_URL, appToken: APP_TOKEN } : undefined
```

Bounded boot like the bundle's `AUTO_START_CEILING_MS` (fall back to undefined → connect prompt).

`lib/cli/startLocalInstance.ts` (NEW) — thin CLI wrapper over `startEmbeddedServer` that
returns `{ url, child }` for the session to own. (Keeps the bundle helper UI-agnostic.)

### 5. The session loop

`lib/cli/runSession.ts` (NEW) — the REPL. Reads lines via Bun's async line iteration over
`console` (`for await (const line of console) {…}`); falls back to one-shot if stdin isn't a
TTY (guard at the `runCli` call site, not here). Owns `target`, swaps it on
`/connect`/`/start`/`/disconnect`, kills `target.child` on swap and on exit. Banner printed
once; status reprinted on every connection change.

Helpers:
- `lib/cli/tokenizeLine.ts` (NEW) — split a session line into argv honouring single/double
  quotes (so `createPost --title "hello world"` works). Small, pure; no dep.
- `lib/cli/printSessionStatus.ts` (NEW) — "Connected to <name> at <url>" /
  "Running a local instance at <url>" / "(not connected — /connect <url> or /start)". App
  name from `probeBelteServer` identity.
- `lib/cli/printSessionHelp.ts` (NEW) — the `/`-meta list; defers to the existing
  `printTopLevelHelp` / `printCommandHelp` for RPCs.

### 6. Top-level routing

**Edit `runCli.ts`**: replace the `!first` → help and the `APP_URL` requirement with the
first-positional precedence above. The connection verbs match their `/`-form exactly — no
bare aliases, no URL detection. `/connect`/`/start`/`/disconnect`/`/help` share the connection
mechanics (`connectToServer`/`startLocalInstance`/`clearLastConnection`) with `runSession` so
they behave identically at the shell and in the session. `/disconnect` → `clearLastConnection`
+ message, exit. `/connect <url>` (url from `argv[1]`) / `/start` / none(+TTY) → `runSession`.
Any other `<cmd>` → `resolveCliTarget` then `dispatchCommand` (error if target undefined: "not
connected — run `appname /connect <url>` or `appname /start`").

### 7. Build: co-ship the server binary

**Edit `src/buildCli.ts`**: after the CLI compile, for each target compile the server binary
into the same dir as `server`/`server.exe` (reuse `compile({ cwd, target, outfile })` +
`serverBinaryFilename(platformOf(target))`). Single-target path writes `dist/cli` + sibling
`dist/server`; cross path writes `dist/cli-thin/<platform>/{<programName>,server}`.

### 8. Download: include the server binary

**Edit `handleCliDownload.ts`**: add the sibling server binary to the tarball entries
(`{ name: serverBinaryFilename(platform), content: bytes, mode: 0o755 }`). `ensurePlatformBinary`
must verify/produce both binaries (extend the freshness check to the server path too).
**Check the install script** (`installScript.ts`) unpacks all entries and `chmod +x` the
server too.

### 9. Help text

**Edit `printHelp.ts`** `printTopLevelHelp`: document the connection verbs
(`/connect <url>` / `/start` / `/disconnect`), that bare `appname` opens a session, and the
`/`-meta set. Keep the env section (`APP_URL` is now the *baked default / scripting override*,
not required).

## Build-order dependency

`buildCli` step 2 already compiles the CLI; the server compile reuses `compile()` which runs
`build()` (which `rm -rf dist`). So compile the **server first**, then the CLI, OR point the
server compile at a temp outfile and move it into place — avoid `compile()` wiping the CLI
output. **Confirm ordering: server compile → CLI compile, or both via outfiles that survive a
shared `dist` clean.** (The cross-compile path writes into `dist/cli-thin/<platform>/`, which
`build()`'s `rm -rf dist` would also clear — verify and sequence the dist-clearing build
first.)

## Reuse summary (what we are NOT writing)

- connect/start/disconnect semantics — `controlServerWorker` (lift the persistence + spawn).
- embedded server spawn + readiness — `startEmbeddedServer` / `waitForServer` / `findOpenPort`.
- server-binary location + naming — `resolveServerBinary` / `serverBinaryFilename`.
- remote dispatch + streaming — `createClient` / `runCli`'s dispatch core (extract, don't rewrite).
- env precedence + baked default — `loadEnvFromBinaryDir` / `loadEnvFromDataDir` / `loadEnvFile`.
- server identity probe — `probeBelteServer`.
- data dir — `appDataDir`.

## Testing / verification (executor)

1. `bunx tsc --noEmit` (or repo typecheck) clean for the package.
2. `cd examples/kitchen-sink && bunx belte cli` → confirm `dist/cli` + sibling `dist/server`
   both produced; cross-build a platform and confirm `dist/cli-thin/<p>/{<name>,server}`.
3. Smoke (no long-lived `bun run dev`):
   - `dist/cli start` → boots a local instance, prints "Running a local instance", session
     prompt; run a bare RPC; `/exit` reaps the child (verify no orphaned `server` process).
   - `dist/cli http://localhost:<a-running-server>` → "Connected to <name>"; `/disconnect`.
   - `dist/cli <cmd> --flag x` (non-TTY pipe) → one-shot, unchanged.
   - `dist/cli disconnect` then `dist/cli` → resumes baked default or shows connect prompt.
4. Download path: `GET /__belte/cli/<platform>` tarball contains cli + server + .env; unpack +
   run `start`.
5. `bun format` all touched files. Do not commit/push unless asked.

## Out of scope

- No daemon / `stop` / pidfile (session-scoped only).
- No README/example changes beyond what verification strictly needs.
- No change to `createClient`, cache/subscribe/rpc/socket internals.
- No new top-level CLI flags.
```
