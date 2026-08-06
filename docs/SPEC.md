# abide primitives

This document is meant to spec all the primitive public apis with simple tables of form | description (1 sentence about behavior, not implementation)

Three isomorphic primitives — **`state`** (own), **`memo`** (load), **`channel`** (subscribe) — one
effect (**`watch`**), and two transport laws over them: **`rpc` = `memo` + transport** and
**`socket` = `channel` + transport**. Every primitive has the same import, the same call, and the same
meaning on both the server and the client.

## What is spec'd here and NOT built

This is a design document, and it describes more than the runtime implements. The gap is listed here
rather than left for a reader to discover at an import error — and rather than left to the README to
apologise for after the fact, which is two documents disagreeing about the same surface.

Everything below is spec'd and **absent**. Rows describing them are marked *(not built)*.

| Area | Absent |
| --- | --- |
| transport | `rpc`, `socket` — the two transport laws in the paragraph above |
| routing | `route()`, `url()`, `navigate()`, and therefore `src/ui/pages/**` |
| ambients | `identity()`, `trace()`, `health()`, `online()`, `appDataDir()` |
| lifecycle | `onStart`/`onHealth` and the config table's env vars |
| source surface | `state.shared`, `memo(fn, transform)`, `throttle`/`debounce`, `fn.done()`, `fn.streaming()`, `watch(source, handler)` |
| `<style>` | the subtree-scoped (nested) form — a compile error naming what is missing |

What IS built is `state` / `memo` / `channel` / `watch`, the shared source surface, the caller scope
(`serve`, `isolate`, `request`, `bag`, `cookies`), both render substrates, hydration, and the
`.abide` compiler.

## Terms

| Term | Defintion |
| --- | --- |
| `value` | anything representable by typescript |
| `expr` | any expression in typescript |
| `key` | idempotent string that represents another `value`
| `serializable` | any value that can be serialized into JSON |
| `initial` | Any initial value |
| `function` | Any function or thenable |
| `v` | Any set value |
| `args` | A single arity argument presented as an object ex: `{a, b}` |
| `dependencies` | In a 0 arity function, dependencies are discovered. In a 1 arity function, dependencies are `args` |
| `tracked` | Rerun when `dependencies` change. |
| `untracked` | Does not have `dependencies`. Reruns imperatively |
| `transform` | `Untracked` `function` that returns a `value` |
| `fn` | `tracked` `function` whose return value is used |
| `source` | `state`, `memo` or `channel` — anything whose CALL is a reactive read. Carries the shared surface below, and is what a template slot READS rather than renders |
| `cell` | a `source` you can also `set` and `await`: `state`, `memo`, and a keyed memo's handle. A `channel` is a source that is **not** a cell — it has `publish` rather than `set`, and never settles |
| `handler` | `tracked` or `untracked` `function`, whose return value is a `dispose` `function` |
| `dispose` | Returned `function` that runs before every re-run of `handler` or once `handler`'s dependencies are unsubscribed |

## `state` — the owned value

| Form | Behavior |
| --- | --- |
| `state(initial)` | Creates a cell that holds a value you write yourself. |
| `state(initial, transform)` | The same cell, but every write passes through `transform` before it is stored. |
| `state.shared(key, initial, transform)` | A cell whose value is shared by `key` across every component instance. |
| `x()` | Reads the value and subscribes the caller, so the caller re-runs when it changes. |
| `x.set(v)` | Writes a new value and wakes every subscriber. |
| `x.peek()` | Reads the value without subscribing to it. |

## `memo` — the loaded value

| Form | Behavior |
| --- | --- |
| `memo(fn)` | A derived value that recomputes whenever anything it read changes. |
| `memo((args) => …)` | A value computed per argument key, with one independently cached slot per distinct set of arguments. only argument key tracked; body is untracked |
| `memo(fn, transform)` | memo derived value passes to transform which runs untracked and memo becomes transform return value. |
| `memo(fn, { ttl })` | The same value, served for at most `ttl` milliseconds before the next read recomputes it. |
| `memo(fn, { global })` | One slot shared by every caller, regardless of which request or process asked. Without it a memo's cache belongs to the caller that filled it. |
| `memo(fn, { tags })` | The value joins named groups so it can be refreshed or invalidated by tag rather than by name. |
| `memo(fn, { throttle })` | Explicit revalidation of a slot that already holds a value fires immediately, then at most once per window. |
| `memo(fn, { debounce })` | Explicit revalidation of a slot that already holds a value waits until the triggers stop. |
| `m(args)` | Reads the value, subscribing the caller and starting a load if there is nothing there yet. |
| `m(args).state(initial)` | A writable view of memo, where a local write holds until the next real load replaces it. |

## `channel` — the subscribed value

| Form | Behavior |
| --- | --- |
| `channel<T>()` | A single stream of messages that anyone may publish to and anyone may subscribe to. |
| `channel<T, Args>()` | The same, split into independent rooms addressed by `Args`. |
| `channel({ tail })` | The stream remembers its last `tail` messages for whoever subscribes next. |
| `channel({ maxAge })` | A message counts as current only while it is younger than `maxAge`. |
| `for await (const m of ch)` | Subscribes and receives every message published from that moment on. |
| `ch.publish(msg)` | Sends one message to every current subscriber. |

## `watch` — the effect

| Form | Behavior |
| --- | --- |
| `watch(handler)` | Runs side effects |
| `watch(source, handler)` | `source` becomes `dependencies` for side effects |

## `rpc` — `memo` + transport

| Form | Behavior |
| --- | --- |
| `GET(fn, opts?)` | Declares a read that any surface may call, addressed by its arguments. |
| `POST` / `PUT` / `PATCH` / `DELETE` | Declare a mutation, which retains nothing by default. |
| `fn(args)` | Calls the handler and resolves to its value, wherever the caller happens to be running. |
| `fn(args, { signal })` | The same call, abandoned when the signal aborts, without affecting anyone else waiting on it. |
| `fn.raw(args, init?)` | The same call, handed back as the raw response instead of a decoded value. |
| `for await (const c of fn(args))` | Consumes a handler that yields chunks, replaying what already happened before following what comes next. |
| `opts.description` | The human description carried onto every generated surface. |
| `opts.schemas` | The declared shape of the input, output and files, enforced at every door the call can arrive through. |
| `opts.clients` | Which surfaces — UI, MCP, CLI — can reach this handler at all. |
| `opts.middleware` | The chain that authorizes and observes every read, from every caller, including in-process ones. |
| `opts.memo` | `memo` options; What the call retains, how long, and under which tags. |
| `opts.timeout` | The longest the call may go without progress before it fails. |
| `opts.crossOrigin` | Which other origins may call it, closed unless declared. |
| `opts.maxBodySize` | The largest request body a mutation will accept. |

## `socket` — `channel` + transport

| Form | Behavior |
| --- | --- |
| `socket<T, Args?>(opts?)` | Declares a stream of messages that reaches subscribers on both sides of the wire. |
| `for await (const m of sock)` | Subscribes and receives messages live, reconnecting on its own if the connection drops. |
| `sock.publish(msg)` | Sends one message to every subscriber, fire-and-forget. |
| `opts.channel` | `channel` options; The underlying stream's own memory: how many messages it keeps and how long one stays current. |
| `opts.clientPublish` | Whether clients may publish at all, and if so what happens to what they send. |
| `opts.schema` | The declared shape of a message. |
| `opts.clients` | Which surfaces can reach it. |
| `opts.middleware` | The chain that authorizes each subscribe and each publish, per room. |

## The shared surface

Every `state` `memo`, `channel`, (and therefore `socket` `rpc` carries the same verbs and probes. A key argument
appears only when the callable has one.

### Verbs — they cause

| Form | Behavior |
| --- | --- |
| `fn.invalidate(args?)` | Discards what is held so the next read starts over. |
| `fn.refresh(args?)` | Recomputes now while continuing to serve what is already held. |
| `fn.publish(args, value)` | Sets the value directly instead of computing it. |
| `invalidate({ tags })` / `refresh({ tags })` | Does the same to everything carrying the tag, on every side that holds it. |

### Reads — they subscribe, and may start work

| Form | Behavior |
| --- | --- |
| `fn(args)` | The current value or nothing yet, filling in on its own once it arrives. |
| `fn.chunks(args)` | Everything a stream has produced so far, in order. |
| `fn.peek(args)` | Exactly what is there right now, subscribing to nothing and starting nothing. |

### Probes — they only observe

| Form | Behavior |
| --- | --- |
| `fn.pending()` | A first load is in flight and there is nothing to show yet. |
| `fn.refreshing()` | A reload is in flight over a value that is still being served. |
| `fn.settled()` | It has finished, however it finished. |
| `fn.done()` | It finished cleanly, as opposed to failing or being cut off. |
| `fn.streaming()` | It is currently producing chunks. |
| `fn.error()` | The failure it ended with, if it failed. |
| `fn.isError(e, name)` | Whether a caught failure is the declared one you named. |
| `fn.watch(handler)` | Runs `handler` whenever the value changes. |

## The caller scope

What a memo's cache belongs to. A module-level `memo` is created once, at import, so on a server its
cache would otherwise outlive the request that filled it — serving the next caller the last one's
data. Per-caller is the default; `{ global }` is how something that belongs to the process says so.

| Form | Behavior |
| --- | --- |
| `isolate(fn)` | Runs `fn` with its own caches and ambients, and drops them when it settles. |
| `serve(request, fn)` | The same, for one request, and what makes the ambients below answerable. |

`isolate` is one variable set and put back, so it holds across an `await` but cannot represent two
callers at once — starting a second while an async one is in flight throws. `serve` is async-local
and has no such limit. On a client there is one caller forever, so neither is needed and a memo
behaves exactly as it would with no scope at all.

## Ambient values

Each answers about the caller's own context and is available on both sides. Outside a `serve` there
is no honest answer, so each throws rather than guessing.

| Form | Behavior |
| --- | --- |
| `route()` *(not built)* | The route being served — its name, kind, parameters, URL, and whether a navigation is in flight. |
| `identity()` *(not built)* | The principal the server resolved for this caller, never null and never guessed by the client. |
| `trace()` *(not built)* | The identifier tying this work to the operation it belongs to. |
| `request()` | The request being served. |
| `cookies()` | The cookies of the request being served. |
| `bag()` | A bag of values carried for the life of one request. |
| `online()` *(not built)* | Whether the client currently has connectivity. |
| `health()` *(not built)* | The app's own account of whether it is working. |

# Logging

| Form | Behavior |
| --- | --- |
| `log(string)` | Log a message to the console with default channel `<app name>` |
| `log.info(string)` | Info level log |
| `log.warning(string)` | Warn level log |
| `log.error(string)` | Error level log |
| `log.trace(string)` | Trace level log |
| `log.channel(string)` | Named channel. Prefixed with `<app name>:`. Abide's default is `abide:`. Channel has same log levels. Gated by `DEBUG` in debug-npm grammar (`abide:*`, `docs:cards,docs:db`, `*`) |

## Reads and writes inside a `.abide` file

A cell is read and written by NAME. The explicit `x()` / `x.set(v)` spelling always compiles — this
is sugar over it, not a replacement.

| Form | Meaning |
| --- | --- |
| `{source}` | the identifier IS the whole expression → the **cell** is handed over. A slot renders it as its value; a prop or a `bind:` receives the cell |
| `{m(args)}`, `{m(args).pages}` | a **keyed** `memo` is read by its CALL the way a cell is read by its name — `m(args)` selects the slot and the handle IS the cell, so no trailing `()` |
| `{source + 1}`, `{source.length}` | used as part of an expression → a **read** |
| `source = v` | a write |
| `source += v`, `source++` | read through `peek` then write — a write must not subscribe. `++`/`--` are statement position only |
| `source()`, `source.set(v)`, `.peek`, `.pending`, … | untouched. The shared surface below is **reserved**; every other property belongs to the value the cell holds |
| shadowing | a `const`/`let`/parameter/`{#for}` binding of the same name shadows, so a loop variable is never read as a cell |
| narrowing | a `{#if}`/`{:else if}`/`{#switch}` condition reads ONCE into a local, and its branch narrows off that — `{#if session}{session.name}{/if}` needs no `?.`. A read is a call, and TypeScript narrows a const but never a call. The body's other reads keep their own thunks, so `{#if mode}{count}{/if}` still wakes on `count` alone |

What counts as a cell is decided **syntactically** — `const x = state(…)` in a `<script>`, or a prop
whose declared `Args` member is `State<…>`/`Memo<…>`/`Cell<…>`/`Channel<…>`. Which of the two `memo`
forms a binding is comes from the same place: `memo(() => …)` declares no arguments, so the NAME is
the cell; `memo(({ id }) => …)` does, so the CALL is. An **imported** cell
cannot be seen that way, so it keeps the explicit spelling; `{count}` alone still renders correctly.

## Template expressions

| Form | Meaning |
| --- | --- |
| `{expr}` | reactive text (escaped) |
| `{html(...)}` | raw HTML |
| `name={expr}` | reactive attribute or property (whole-value expression) |
| `on<event>={fn}` | native listener (`oninput`/`onclick`/…) on an ELEMENT. On a **component** the same syntax is an ordinary prop named `onclick` — no element to attach to, so the component places it itself |
| `name="…{expr}…"` | quoted values interpolate too (reactive) — mixed literal + `{expr}`, also on component props; a literal brace is `{'{'}` |
| `bind:value` | two-way bind — read the property, write back on input/change (also on component props) |
| `bind:checked` / `bind:selected` | boolean bind — a boolean DOM property mirrored as a boolean attribute: present iff truthy, never stringified |
| `bind:group` | radio/checkbox membership, compared against the input's own `value`; never emitted as a `group` attribute |
| `bind:value={{get, set}}` | two-way bind over an explicit accessor pair |
| `bind:element={state \| fn}` | node ref (state) or per-instance `handler` with node ref as argument. Client-only — nothing is rendered for it during SSR |
| `class:name={cond}` | toggle a class. **ELEMENTS ONLY** — a compile error on a component (pass a prop instead) |
| `style:prop={value}` | set one style property. **ELEMENTS ONLY**, same rule |
| `{...expr}` | spread props (component) / attributes (element) |

## Control flow

| Block | Branches / notes |
| --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` |
| `{#for item, i of list by key}` | keyless → positional (dev-warns if the body is stateful) |
| `{#for await item of source}` | streaming list; `{:catch}`. REACTIVE, not one-shot: a `refresh()`/`invalidate()` or a change to a reactive dep in the source tears the list down and re-streams it. Rows go to the same list part a `{#for}` uses, so a key still MOVES a row |
| `{#await p}` | `{:then v}`, `{:catch e}`, `{:finally}`. The operand is evaluated by the slot's own effect; the branches are closures the renderer calls later, so settling never re-evaluates the operand and an inline promise is safe. A server render AWAITS rather than showing `pending` — it is a snapshot with nothing to wake |
| `{#await p then v}` / `{#await p catch e}` | inline shorthand — body = that branch, no pending branch (the compact blocking form) |
| `{#switch expr}` | `{:case v}`, `{:default}` |
| `{#try}` | `{:catch e}`, `{:finally}` — JS-semantics error boundary, so SYNCHRONOUS: a rejected promise inside is not its to catch. The body is the one place expressions do not each get their own thunk — a boundary is one unit, which is what lets it catch, and the cost is that a dependency inside re-runs the whole body |
| `{#component Name(props)}` | **inline component** — a reusable builder. Name must be TitleCase (lowercase is a parse error, reserved for element tags). Invoked as a tag `<Name/>`. Passable as a first-class value/prop. Takes `args`; children arrive through `<slot/>`. A nested `{#component X()}` inside `<Foo>…</Foo>` becomes Foo's `X` prop |

## Components

| Feature | Notes |
| --- | --- |
| `<Name/>` | Capitalised tag = component invocation |
| `<slot/>` | renders default children  |
| `<Tag>…</Tag>` | children passed to the component's `<slot/>` |
| nested `{#component X()}` | named component prop (render-prop) |
| `const C = memo(…)` → `<C/>` | a state- or memo-named tag is a **reactive** component (re-mounts on change) |

## Rendering

| Form | Behavior |
| --- | --- |
| `renderToString(node, opts?)` | The whole render as one string. Synchronous internally: a tree with nothing to await produces the document without a promise. |
| `render(node)` | The same walk as an async iterable of chunks. |
| `toStream(node, opts?)` | The same walk as a `ReadableStream`, so the response back-pressures. |
| `renderDocument(head, body, opts?)` | A whole document: shell, body in order, then out-of-order patches as they resolve. |
| `suspend(value, body, fallback?)` | Emit a placeholder now and the real subtree when the value lands. |
| `opts.hydratable` | Also emit the markers a hydrating client adopts by. Off unless asked for. |
| `mount(container, view)` | Build live DOM and keep it live. Returns `{ dispose }`. |
| `hydrate(container, view)` | The same, over markup a `{ hydratable: true }` render already wrote — every part adopts its range instead of building one. A divergence rebuilds that subtree and warns. |

Only a CHILD slot carries markers: an opening comment before its value and, after it, the anchor the
client's template already uses. Elements holding any other slot kind are found positionally, and a
list row delimits itself, so neither carries one.

A chunk boundary is a **suspension**, not a string segment. Everything written so far goes out before
the walk waits — so a slot that has to load holds the walk and the shell is already gone — and a long
synchronous run is handed over once it passes a high-water mark. Nothing else chunks: splitting
markup nobody is waiting on costs a consumer round trip per piece and buys nothing.

## The compiled form

A `.abide` file compiles to an `html` tagged template — the shape `packages/example/app.ts` is by
hand. Every expression gets its own thunk, so a `{#if}` subscribes to its condition alone.

| Slot spelling | Emitted for |
| --- | --- |
| `name=${v}` | `name={expr}` and `name="…{expr}…"` (the compiler owns the whole value, so a quoted attribute interpolates) |
| `@event=${fn}` | `on<event>={fn}` on an element |
| `.prop=${v}` | the read half of a `bind:` |
| `&ref=${x}` | `bind:element` — the NODE itself, so nothing is emitted for it during SSR |
| `...=${obj}` | `{...expr}` on an element; names are not known until the value arrives |

`classes()` and `styles()` in `abide` are what `class:name={c}` and `style:prop={v}` merge into —
one attribute however many toggles it carries.

## Script / style blocks

| Block | Scope |
| --- | --- |
| `<script>` | per-instance (component setup). `export` is a compile error — the body is inlined into the setup, so it has nowhere to go |
| `<script module>` | module scope, so `export` belongs here |
| nested `<script>` | branch-local (per-ITEM in a `{#for}`). Must be the FIRST node of a block body — whitespace and comments do not count — carries no `import` (it reuses the component's), and its bindings resolve off the level's `scope`: shadowing inside the branch, invisible outside it. A `{#for}` splices the statements into the row closure it already has; every other body pays one call |
| `<style>` | component-scoped: every element the component writes carries `data-a<hash>`, and every selector requires it on its rightmost compound. Registered once at module scope; `styleTags()` is what a server render puts in `<head>` — one `<style data-abide="…">` per scope, so a hydrating client can see what the document already carries and not append a second copy |
| nested `<style>` | subtree-scoped — an element carries every scope in force, so an outer rule reaches in and an inner one cannot reach out |

## Pages / routing

| Feature | Notes |
| --- | --- |
| `src/ui/pages/**/page.abide` | a route |
| `src/ui/pages/**/layout.abide` | a layout; renders its child page through `<slot/>` |
| `[name]` | required dynamic segment → `route().params.name` |
| `[[name]]` | optional segment (absent → param omitted) |
| `[...name]` | rest / catch-all (terminal) → the `/`-joined remaining segments |
| precedence | literal > required > optional > rest |
| `route()` *(not built)* | `.url`, `.params`, `.name`, `.kind`, `.navigating` |
| `url(path, params?, query?)` *(not built)* | build an in-app href |
| `navigate(target, options?)` *(not built)* | move to one — `{ replace?, keepScroll? }`. Same-route param/query nav = a pure `route()` republish (reads re-fire in place, no DOM swap, no re-hydrate) |

# Environment variables

| Name | Purpose |
| --- | --- |
| `PORT` | Listen port (default `3000`). `--port` overrides. `abide dev` hops to the next open port if taken; `abide start` binds directly and fails hard on `EADDRINUSE`. |
| `APP_URL` | Public URL / mount base, and the expected origin both origin gates compare against (WS CSWSH gate, CSRF gate). A `abide dev` port hop carries it to the port actually bound. |
| `NODE_ENV` | Production vs development. Gates `Strict-Transport-Security`, the identity-secret requirement, and other prod-only behaviour. |
| `ABIDE_APP_NAME` | The app's own name (falls back to package.json `name`, then `abide`). |
| `ABIDE_DATA_DIR` | Override the per-user data dir backing `appDataDir()`. |
| `ABIDE_IDENTITY_SECRET` | Seals the `abide-identity` cookie + tokens. Required in production for authenticated `identity.set()`. |
| `ABIDE_IDENTITY_TTL` | Identity cookie/token TTL in ms (default 30d, rolling). |
| `ABIDE_APP_TOKEN` | Bearer token for the remote CLI & desktop bundle. |
| `ABIDE_APP_URL` | App URL for the remote CLI & desktop bundle (also marks a cross-origin proxy, which then declines to volunteer `traceparent`). |
| `ABIDE_RPC_TIMEOUT` | Default RPC run deadline in ms (default `300000` = 5 min) — a fallback ceiling; per-RPC `timeout` is the real knob. |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Default ceiling on a mutation's request body (unset = no ceiling); per-RPC `maxBodySize` overrides. Over-size declared `content-length` → 413 before buffering. |
| `ABIDE_MAX_GLOBAL_CACHE_SIZE` | Byte ceiling (LRU) for the global + default-context memo cache (default: no limit). |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | Per-stream transcript cap in bytes (default: no limit; exceeding it overflows the buffer and disables replay). |
| `ABIDE_SSR_STREAM_BUDGET` | Total wall budget in ms for an SSR stream (default `300000`). |
| `ABIDE_LOGS` | Opt IN to the remote log feed (`GET /__abide/logs`, what `./app logs` tails). Default closed → 404. |
| `ABIDE_LOG_BUFFER` | Ring size in records for that log feed (default `500`). |
| `ABIDE_LOG_FORMAT` (`tsv` \| `json`) | Machine log format. Unset, the shape follows the TTY: pretty at a terminal, `tsv` through a pipe. |
| `DEBUG` | Server-side log-channel gating (browser equivalent: `localStorage.debug`). |
| `NO_COLOR` | Disable colour everywhere (log lines, CLI banner, REPL banner + ghost text); forces `tsv` log output. |
| `FORCE_COLOR` | Force colour/pretty output even when not a TTY. |

| Export | Signature | Purpose |
| --- | --- | --- |
| `middleware` | `Array<(next: () => Promise<Response>) => Response \| Promise<Response>>` | The per-REQUEST auth/observability rung (onion; `next()` takes no args). Can be short-circuited by a throw or Response. Auth is middleware. |
| `onStart` | `(start: () => Promise<void>) => void \| Promise<void>` | WRAPS the real boot. Do setup, then `await start()` — the socket binds only inside it, so nothing serves until setup finishes. Returning without calling `start()` is a breakout: the app never boots. Awaited. |
| `onStop` | `(stop: () => Promise<void>) => void \| Promise<void>` | Mirrors `onStart` for teardown: drain, then `await stop()`. Backstopped, so teardown still happens if the hook skips it. Runs on SIGINT/SIGTERM/crash. Awaited |
| `onError` | `(error: unknown) => unknown` | Request-scoped; runs when a request throws an UNEXPECTED error. A DELIBERATE outcome never reaches it |
| `onHealth` | `() => unknown \| Promise<unknown>` | Returns fields merged OVER the framework baseline `{ reachable, version, startedAt, uptime }`. It is what `health()` composes into its document on EVERY server-side call |

# abide cli

| Command | Purpose |
| --- | --- |
| `abide scaffold <name>` | Write a starter project, then `git init` + `bun install` + `abide dev` — each skippable (`--no-git`/`--no-install`/`--no-dev`). |
| `abide dev [--port <n>]` | Same pipeline as `build`, plus watch + full live-reload over the socket mux. `--port` (default `3000`) HOPS to the next open port if taken — and the hop carries `APP_URL` with it, since that's the origin both gates compare against (WS CSWSH, CSRF); left stale the server rejects its own browser. Graceful `onStop` on SIGINT/SIGTERM/crash. |
| `abide build` | Code-split client → content-hashed chunks + `manifest.json`, each asset minified and precompressed (`.br`/`.gz` sidecars listed in the manifest's `encodings`) |
| `abide start [--port <n>]` | Serve against the `abide build`. `--port` binds DIRECTLY and fails hard on `EADDRINUSE`, so `APP_URL` can't drift. |
| `abide run <file> [args…]` | Run a script under the abide runtime. Everything after `<file>` belongs to the SCRIPT |
| `abide check` | Type-check `.abide` script bodies |
| `abide lsp` | `.abide` language server over stdio |
| `abide compile [--target] [--out] [--platforms]` | ONE standalone executable (`bun build --compile`; `--platforms` cross-compiles a release set for the price of one client build (with it, `--out` names a DIRECTORY). |
| `abide bundle` | Desktop launcher for the host platform (embeds assets, first-run setup screen). Native windowing is best-effort — a system webview binary or the default browser. |
| `abide` · `-h` · `--help` | Usage, GENERATED from that same table. Asking for help is a success (stdout, `0`); an unknown subcommand is not (stderr, `2`) — a mistyped command exiting `0` tells CI the build succeeded. |

Exit codes (`CLI_EXIT_CODES`, shared verbatim with the compiled binary): `0` ok · `1` failed/unreachable · `2` usage · `3` 422 · `4` 401/403 · `5` 404 · `6` 504 · `7` 5xx · `8` other 4xx.
