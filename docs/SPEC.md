# abide primitives

This document is meant to spec all the primitive public apis with simple tables of form | description (1 sentence about behavior, not implementation). Not for prose.

Three isomorphic primitives — **`state`** (own), **`memo`** (load), **`channel`** (subscribe) — one
effect (**`watch`**), and two transport laws over them: **`rpc` = `memo` + transport** and
**`socket` = `channel` + transport**. Every primitive has the same import, the same call, and the same
meaning on both the server and the client.

## Entry points

Six specifiers, and which half of the stack each one is. The split is what a page pays for: the two
renderers are separate because only one of them ships to a browser, and nothing in `abide` imports
either.

| Specifier | Holds |
| --- | --- |
| `abide` | the isomorphic surface — the three primitives, `watch`, the template tag and its runtime, the caller scope, `log`, `online()`, `health()`, `identity()`, and the client half of both transports (`remote`, `remoteSocket`) |
| `abide/ui` | the DOM substrate — `mount`, `hydrate` |
| `abide/server` | the SSR substrate — the render walk, `suspend`, the request scope and the ambients on it (`request`, `cookies`, `bag`, `trace`, `identity`), `appDataDir()`, `server()`, `onHealth()`, `onIdentity()`, `pages()`, and the DECLARING half of both transports (`GET`…`DELETE`, `socket`, `dispatch`, `Schema`) |
| `abide/tests` | the test kit — the `Case` shape, assertions, DOM counters, bench timing, `loopback()` |
| `abide/compiler` | `compile()`, `elide()` and their diagnostics. Pure: text in, text out, no filesystem |
| `abide/compiler/check` | the check lane: `emitFor` writes the module, its declaration and its map beside a `.abide`, and `remap` moves a `tsc` diagnostic back onto the `.abide` line |
| `abide/compiler/shapes` | the second speed: `deriveShapes` runs the real checker over a project and answers with the shapes tokens cannot read |
| `abide/compiler/plugin` | the Bun plugin: compiles `.abide` on import, and elides a transport module to the stub or the registration its lane needs |

A handler is DECLARED through `abide/server` and CALLED through the module it lives in, so an app
imports one name and the lane decides what is behind it. The client half is on the isomorphic surface
because that is what a generated stub imports — `remote(id)` written by hand is the same file.

## What is spec'd here and NOT built

This is a design document, and it describes more than the runtime implements. The gap is listed here
rather than left for a reader to discover at an import error — and rather than left to the README to
apologise for after the fact, which is two documents disagreeing about the same surface.

Everything below is spec'd and **absent**. Rows describing them are marked *(not built)*.

| Area | Absent |
| --- | --- |
| transport | `opts.clients` — which surfaces may reach a handler, which says nothing until there is a surface other than the UI to name. Everything else in both laws is built |
| lifecycle | `onStart`. Every env var in the config table is now read by something EXCEPT the four a binary would own — `PORT`, `APP_URL`, `ABIDE_APP_TOKEN`, `ABIDE_APP_URL` — which is the CLI's row below rather than this one |
| the CLI | every `abide <command>`, the app-level exports (`middleware`, `onStart`, `onStop`, `onError`), and the four environment variables only a binary reads — there is no binary yet, so nothing reads any of it. `./app logs` is the one command whose ENDPOINT exists ahead of it: `GET /__abide/logs` is served, and what is missing is a client for it |

What IS built is `state` / `memo` / `channel` / `watch` and the escape hatches around them
(`untrack`, `scope`, `isolate`), the WHOLE shared source surface, the request scope (`serve`,
`request`, `bag`, `cookies`, `trace`, `identity` with `onIdentity` under it, `isServing`) and the four
ambients that answer outside one
(`online`, `health` with `onHealth` under it, `appDataDir`, `server`), routing (`routes`, `route`, `url`, `navigate`, `ready`,
`outlet`, and `pages(dir)` for a pages directory), both transports and the seam that addresses them, the
template tag and its runtime, both render substrates, hydration, `<style>` in both its component and
its subtree form, `log` with its channels and its remote feed, the three ceilings, the `.abide`
compiler, and the test kit.

## Terms

| Term | Definition |
| --- | --- |
| `value` | anything representable by typescript |
| `expr` | any expression in typescript |
| `key` | idempotent string that represents another `value` |
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
| `state(promise)` | The same cell, started cold on a LOAD rather than holding the promise — so the read is the same call either way, and the cell is `pending` until it lands. |
| `state(asyncIterable)` | The same cell again, started on a STREAM: it holds the LATEST chunk, `chunks()` holds the transcript, and the read is the same call a third time. |
| `state(initial, transform)` | The same cell, but every write passes through `transform` before it is stored — the `initial` included, because a normaliser with a hole in it exactly where the author put the value is not a normaliser. `transform` is untracked, and on a load or a stream it sees what LANDED. A throw is a failed write: it throws at the call site on a sync write, and settles the cell as a failure on a load. |
| `state.shared(key, initial, transform?)` | A cell whose value is shared by `key` across every component instance. The first call decides the value; a later one gets the cell that exists and its `initial` is not consulted. Per-caller, like a memo's cache — on a server, "every component instance" must not quietly mean "every visitor". |
| `x()` | Reads the value and subscribes the caller, so the caller re-runs when it changes. THROWS if the last load failed — ignoring that is not handling it. |
| `x.set(v)` | Writes a new value and wakes every subscriber. A promise is a load and an async iterable is a stream; anything else settles the cell in the call. |
| `x.peek()` | Reads the value without subscribing to it, and without ever throwing. |
| `x.invalidate()` | Drops the value and any error, cancels what is in flight, and goes back to cold. |
| `await x` | Waits for the cell to settle and resolves the loaded value — narrower than `x()`, which may find nothing there yet. |

## `memo` — the loaded value

| Form | Behavior |
| --- | --- |
| `memo(fn)` | A derived value that recomputes whenever anything it read changes. |
| `memo((args) => …)` | A value computed per argument key, with one independently cached slot per distinct set of arguments. only argument key tracked; body is untracked |
| `memo(fn, transform)` | memo derived value passes to transform which runs untracked and memo becomes transform return value. The body declares the dependencies; what the transform reads is not one. On a load it runs over the value that landed. Options still follow: `memo(fn, transform, opts)`. |
| `memo(fn, { ttl })` | The same value, served for at most `ttl` milliseconds before the next read recomputes it. |
| `memo(fn, { global })` | One slot shared by every caller, regardless of which request or process asked. Without it a memo's cache belongs to the caller that filled it. This is the cache `ABIDE_MAX_GLOBAL_CACHE_SIZE` bounds — see Ceilings. |
| `memo(fn, { tags })` | The value joins named groups so it can be refreshed or invalidated by tag rather than by name. A function receives the slot's args, which is how a tag names one ROW rather than every row the memo holds. |
| `memo(fn, { throttle })` | Explicit revalidation of a slot that already holds a value fires immediately, then at most once per window. A cold slot is never paced — there is nothing on screen for a window to protect — so a read that finds a slot cold still loads in the call. |
| `memo(fn, { debounce })` | Explicit revalidation of a slot that already holds a value waits until the triggers stop. Same rule about cold; set with `throttle`, this wins. |
| `m(args)` | SELECTS the slot and hands back its cell. Selecting starts nothing; the read is what kicks a load. |
| `m.refresh()` / `m.invalidate()` | Every slot, or every slot matching a `Partial<Args>` pattern — compared the way slots are keyed. One slot is `m(args).invalidate()`, which is why the pattern form is free to mean "match". |

A slot is a cell, so it already has `set` — there is no separate writable view, and no second
spelling for "write it directly". `m(args).set(v)` IS the local write, and it holds until the next
real load replaces it, exactly as it does on any other cell with a body.

## `channel` — the subscribed value

| Form | Behavior |
| --- | --- |
| `channel<T>()` | A single stream of messages that anyone may publish to and anyone may subscribe to. |
| `channel<T, Args>()` | The same, split into independent rooms addressed by `Args`. `ch(args)` SELECTS a room and hands back an ordinary channel; the CALL is what tells the two forms apart, exactly as it does for `memo`. Rooms are process-wide, because a channel is not a cache: a publisher has to reach subscribers that arrived some other way. |
| `ch.invalidate(pattern?)` | On the room form: every room matching a `Partial<Args>`. No pattern means every room, and the stream a bare `ch()` reads along with them. |
| `channel({ tail })` | The stream remembers its last `tail` messages for whoever subscribes next. Default 0 — latest only. |
| `channel({ maxAge })` | A message counts as current only while it is younger than `maxAge`. Expiry WAKES: a reader that only found out on its next read would go on showing a message the channel had stopped claiming. |
| `ch()` | The latest message, subscribing the caller — the same call every other source spells a read with. |
| `ch.peek()` | The latest message, subscribing to nothing. |
| `ch.chunks()` | The session transcript, capped at `tail`, and reactive. A new array per publish, the same one between publishes. The cap bounds what is REMEMBERED and never reaches the publish: the buffer is pushed into and compacted once per `tail` messages, so `tail: 500` costs a publish no more than `tail: 8` does. |
| `ch.publish(msg)` | Sends one message to every current subscriber. Delivery is against a snapshot, so subscribing during a round does not receive that round's message and unsubscribing does not cancel it. |
| `ch.subscribe(fn)` | A plain listener outside the graph; returns its own unsubscribe. |
| `for await (const m of ch)` | Subscribes and receives every message published from that moment on. |
| `ch.tail()` | The same sequence with the transcript REPLAYED in front of it. The snapshot and the subscribe happen in the same synchronous run, so a message published between them is missed by neither — which is what makes it the whole of the remote log feed. |
| `ch.invalidate()` | Forgets what has arrived — the verb means here what it means everywhere: this is no longer good. |

A channel never loads, so `pending()` / `refreshing()` / `error()` are always the cold answer. They
are present so a reader can treat any source alike instead of having to know which primitive it was
handed; `settled()` asks whether anything CURRENT has arrived at all. It is also the one source
whose stream has no end, so `streaming()` is true and `done()` is false, always.

## `watch` — the effect

| Form | Behavior |
| --- | --- |
| `watch(handler)` | Runs side effects. Reading a cell inside the handler IS the subscription — there is no dependency array. Effects are batched onto a microtask. |
| `watch(source, handler)` | The dependency DECLARED rather than discovered: `source` is the only thing read under tracking, so `handler` — which receives the value — may read whatever it likes without subscribing to it. Same immediate first run, same teardown, same disposer. |
| `x.watch(handler)` | The same effect spelled off the source, so a caller holding one cell does not have to reach for `watch` to react to it. Which source you asked IS the declaration, so the handler is untracked for the same reason. |
| the return of `watch` | The disposer. Calling it unsubscribes the effect for good. |
| the return of `handler` | The teardown, run before every re-run and once on disposal. This is the whole lifecycle story — there is no `onMount`/`onDestroy` because the effect already has both ends. |
| `untrack(fn)` | Runs `fn` reading whatever it likes without any of it becoming a dependency. |
| `scope(fn)` | Runs `fn` and returns `{ value, dispose }`, where `dispose` tears down every `watch` created inside it, in reverse order. |

A `watch` created inside a `scope` registers with it automatically. There is deliberately no second
opt-in spelling: an ownership rule that applies only when you remember the other function is not an
ownership rule, and the failure mode is a leak nobody sees.

## `rpc` — `memo` + transport

| Form | Behavior |
| --- | --- |
| `GET(fn, opts?)` | Declares a read that any surface may call, addressed by its arguments. |
| `POST` / `PUT` / `PATCH` / `DELETE` | Declare a mutation, which retains nothing by default. |
| `fn(args)` | SELECTS the slot and hands back its cell, exactly as a keyed `memo` does — an rpc IS one. Reading it is what reaches the handler, wherever the caller happens to be running. |
| `fn(args, { signal })` | The same call, abandoned when the signal aborts, without affecting anyone else waiting on it. |
| `fn.raw(args, init?)` | The same call, handed back as the raw response instead of a decoded value. |
| a `File` in `args` | Travels as multipart, with the JSON keeping a REFERENCE where the file sat — the same one args object, so nothing about the declaration or the call says "upload". |
| `for await (const c of fn(args))` | Consumes a handler that yields chunks, replaying what already happened before following what comes next. A handler yields iff it is declared `function*`, which is how the browser lane knows without a type-checker. |
| `opts.description` | The human description carried onto every generated surface. |
| `opts.schemas` | The declared shape of the input and the output, enforced at every door the call can arrive through. Derived from the handler's TYPE when nothing is declared, so an endpoint publishes what it takes without anyone writing the same fact twice. A `File` is a member like any other — `{ type: 'string', format: 'binary' }` — so there is no files option and no upload endpoint. |
| `opts.clients` *(not built)* | Which surfaces — UI, MCP, CLI — can reach this handler at all. |
| `opts.middleware` | The chain that authorizes and observes every read, from every caller, including in-process ones. |
| `opts.memo` | `memo` options; What the call retains, how long, and under which tags. |
| `opts.timeout` | The longest the call may go without progress before it fails. |
| `opts.crossOrigin` | Which other origins may call it, closed unless declared. `'*'` opens it to every origin; a websocket upgrade is gated by the same list, because CORS does not reach one. |
| `opts.maxBodySize` | The largest request body a mutation will accept. |

## `socket` — `channel` + transport

| Form | Behavior |
| --- | --- |
| `socket<T, Args?>(opts?)` | Declares a stream of messages that reaches subscribers on both sides of the wire. |
| `for await (const m of sock)` | Subscribes and receives messages live, reconnecting on its own if the connection drops. |
| `sock.publish(msg)` | Sends one message to every subscriber, fire-and-forget. |
| `opts.channel` | `channel` options; The underlying stream's own memory: how many messages it keeps and how long one stays current. |
| `opts.clientPublish` | Whether clients may publish at all, and if so what happens to what they send. `false` by default — a socket is a broadcast until an app says otherwise. |
| `opts.schema` | The declared shape of a message a CLIENT sends — the wire is the only door one arrives through from outside the process. |
| `opts.clients` *(not built)* | Which surfaces can reach it. |
| `opts.middleware` | The chain that authorizes each subscribe and each publish, per room. |

### How a handler is addressed

The one decision that would have forced a redesign if guessed wrong: how a handler declared ONCE is
reached from a browser without its body going there.

| Rule | Why it is this |
| --- | --- |
| The directory is the kind — `server/rpc/**` is rpc, `server/sockets/**` is a socket | A Bun plugin filter is a PATH regex, so a `'use server'` directive would mean intercepting every `.ts` in the graph. A path costs one regex, tells the plugin which stub to write before it reads the file, and gives a misplaced declaration something to disagree with. |
| An endpoint is recognised SYNTACTICALLY — `export const NAME = GET(…)` | The same rule `.abide` lives by, for the same reason: the emit path must not need a type-checker, because the browser lane produces the stub from a file it is about to throw away. Any other export in those directories is a compile error naming the export. |
| Everything abide serves is under `/__abide/`, and the module's own path is the rest | One reserved prefix means an app author needs one rule to know what is theirs and an operator needs one pattern to proxy, cache, CSP or exclude. `dispatch` returns nothing for anything outside it. |
| There is no hash | Mandating the directory removed the ambiguity a hash existed to resolve, and the filesystem already forbids two files at one path. An address legible in a stack trace is worth more than the bytes. |

| File | Export | Served at |
| --- | --- | --- |
| `server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` |
| `server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |
| `server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

The kind stays in the path even though the rest is already unique, because a socket is a websocket
upgrade rather than a POST — genuinely different routes — and because a network panel showing the
address says what happened without anyone decoding it.

What each lane is handed for `server/rpc/users.ts`:

| Lane | Gets |
| --- | --- |
| browser | `export const getUser = remote("users/getUser", { method: "GET" })` — the address, and none of the module |
| server | the module VERBATIM, plus an appended `register("rpc", [["users/getUser", "getUser"]], { getUser })`. Appended, so every line the author wrote keeps its number and a stack trace still points at the handler |

A read travels as an HTTP GET with its args JSON in one query parameter, so the address says what it
is and an intermediary may cache it; past the ceiling every proxy puts on a URL the same read falls
back to a POST body, which the server accepts for a read and only for a read. A mutation travels as
its own method with a body.

What that establishes is the LAW, not the plumbing: three concurrent readers of one key cost one
request, and nothing in the transport does that — the memo slot does, exactly as it already did for a
local load. The server half of a socket is `channel()` unchanged, and the whole transport is one
`subscribe` on upgrade and one unsubscribe on close.

A declaration's OPTIONS do not cross the wire, and cannot: `GET(fn, { middleware: [auth] })` is
server-side text and an option may reference a server-only import, so there is nothing a stub could
copy. What crosses is the CONSEQUENCE — a `ttl` arrives as an `abide-ttl` response header, in
milliseconds, and the client's slot goes cold on the server's schedule. Tags do not cross, so
`invalidate({ tags })` reaches one side at a time.

A failure crosses as `{ name, message }` and is rebuilt with its name, which is what makes
`isError(e, name)` answer over a wire — the NAME rather than the class, because `instanceof` on a
deserialised error is false however faithfully it was written out.

A declared shape is checked in the memo's BODY, which is the one place every door leads to: the wire
call, the in-process call and a handler another handler reaches all run it, so there is no door that
could be added later and forget to. A schema RETURNS what it accepts, so it normalises as well as
refuses — and the slot stays keyed by what the CALLER asked with, because the key is the question,
and two spellings of one question are two slots holding one answer. An input that does not match is
the caller's fault and answers 422; an output that does not is ours and answers 500, checked per
CHUNK on a handler that yields, since a shape checked only at the end is one nothing on the other
side was reading by then. Both travel under the name `AbideSchemaError`, so `isError` asks about
them the way it asks about anything else that crossed.

JSON Schema is what a declaration MEANS, and the other two forms are alternative validators over the
same call. That order is forced rather than chosen: Standard Schema — the interop spec zod, valibot
and arktype all answer to — is validate-only, so a shape declared through one cannot become a tool
definition, an OpenAPI operation, or anything else a machine reads BEFORE it calls. A shape abide can
only run is a shape abide cannot publish. So a shape is one of three things: a **JSON Schema**, the
native one; a **plain function**, which returns what it accepts and THROWS what it refuses, and is
synchronous by that contract because there is nowhere in a throw to put a promise; or a **Standard
Schema**, whose `validate` may return a promise. abide declares the Standard Schema interface itself
and imports none of the libraries that implement it.

A socket's `schema` is the WIRE's door and only the wire's, because the server half is `channel()`
unchanged — an app publishing into its own stream is publishing a value it already holds rather than
sending one, and a client message that does not match is dropped like every other refusal on that
path.

### The shape nobody wrote

`GET(({ id }: { id: number }) => …)` already says what the call takes. Restating that in a schema is
writing one fact twice and keeping the two in step by hand, so the compiler reads it off the
annotation and appends it to the `register(...)` it already writes. A declared schema OVERRIDES the
derivation; a derived one is what fills the gap, and it is enforced as well as published — a shape
that only appeared in a document would be a claim nothing checks.

| Read from | What it says |
| --- | --- |
| `GET<Args, T>(…)` | Both directions, explicitly. Wins, because an author who wrote the type arguments wrote them to be read. On a socket the first argument is the MESSAGE and the second is the room, which addresses a subscriber rather than travelling in one |
| the first parameter's annotation | the input |
| the return type's annotation | the output — and on a handler that yields, `AsyncGenerator<T>`'s argument, because a transcript is not one value |
| a `type`/`interface` in the same file | resolved, including one that names another |
| a type IMPORTED from another file | resolved, aliased or not, transitively, with a cycle guard — when the caller supplies a resolver |

An imported type is a FILESYSTEM question rather than a type-checker one — an interface in another
module is a plain interface, and the only thing one file's tokens lack is the other file's text. So
`elide` takes a `resolve` rather than reaching for one: it still does no I/O, which is what keeps a
demo case able to assert an elided module in a browser card, and `abide/compiler/plugin` is where the
reading lives. It is consulted LAZILY, cached per module, and withheld from the browser lane
entirely — the stub carries no shapes, so the lane that throws the module away also does none of the
reads. Relative specifiers resolve beside the importer and anything else goes through Bun's resolver,
so a `paths` alias misses; a specifier that does not resolve costs a shape rather than a build.

SYNTACTICALLY, with the same scanner and for the same reason as everything else in the emit path:
this runs in the browser lane too, on a file it is about to throw away. What that costs is reach, and
the rule for every gap is the same — a derived shape may know LESS than the type does, because
under-constraining refuses nothing the handler would have accepted, while over-constraining refuses a
call that was correct at a door the author never wrote. So an unreadable member is the empty schema,
which matches everything, and a type that is entirely unreadable publishes nothing at all.

| Not derived | Why |
| --- | --- |
| an imported type with no resolver supplied | one file's tokens cannot reach another file's text, and the pure form of `compile`/`elide` is what a caller may rely on |
| a generic alias, or a reference with type arguments | its body mentions a parameter nothing here can bind. The utility types that ARE understood are the ones whose meaning is structural: `Array`, `ReadonlyArray`, `Record`, `Partial`, `Readonly`, `NonNullable`, `Promise`/`Awaited`, and the async-iterable family |
| `Pick` / `Omit` / `Required` / `Exclude` / `ReturnType` … | the same rule: a utility that has to compute over a type is one a checker computes |
| `keyof`, `typeof`, conditional, mapped and template-literal types | readable by a checker, not by a scanner |
| a TypeScript `enum` | a value declaration, not a type this reads |
| a qualified name (`NS.Args`) | no part of it resolves from here |
| a handler passed by NAME rather than written at the call site | the same limit `streams` has, for the same reason |
| a `Map` or a `Set` | neither survives `JSON.stringify` — both come out `{}` — so a shape saying "object" or "array" would publish that breakage as a contract |
| an intersection with a non-object side | only object literals merge |

Three things it derives LOOSELY rather than not at all. A **tuple** becomes an array of whatever its
positions hold, losing order and length. A **recursive** member stops at the cycle. And an object is
left OPEN — `additionalProperties` is never `false` — because TypeScript's excess-property check is a
rule about literals, not about values, and a caller passing one more field is not making a mistake
the wire should refuse.

An **output** is derived only from an explicit type argument or an annotated return type, and most
handlers annotate neither — so `input` is the common case and `output` is the deliberate one.

Where a value is one thing on the wire and another in the process, the PUBLISHED shape is the wire
form, because that is what a machine reading the document is about to send: a `File` is
`string`/`binary`, a `Date` and a `URL` are the strings their own `toJSON` makes of them. The gate
accepts the local form beside it, since an in-process caller never encoded one.

The shape reaches the SERVER lane only. The browser has the types already, and a schema in the stub
would be bytes that answer nothing.

### The second speed

The token pass stops where a type has to be COMPUTED — `Omit<User, 'id'>`, a conditional, a mapped
type, an `enum`, a generic alias. Unlike an import, that is not a filesystem problem: no amount of
text resolves them, because resolving them is what a checker IS. So `abide/compiler/shapes` runs the
real one over the whole project and writes what it found to `.abide/shapes.json`, which the Bun plugin
reads and hands to `elide`.

| | |
| --- | --- |
| what it adds | the computed types, and an OUTPUT for every endpoint — a declaration IS an `Rpc<Args, T>`, so both directions are on it whether or not a handler annotated a return |
| how it joins | by `endpointId`, the same address the registration uses |
| staleness | it only ever UPGRADES. An endpoint it says nothing about keeps what the tokens said, so a missing or old file costs detail in a published document and nothing else — which is the direction a derived shape is already allowed to be wrong in |
| why a process | TypeScript 7's checker is the native `tsgo` binary behind a synchronous RPC channel that reads a Node-internal file descriptor. It cannot run under Bun, so the Node half holds the converter and knows nothing about abide; this half owns the address scheme |

`bun run shapes` writes the file. Nothing requires it: without one, everything still compiles, serves
and validates — it publishes less.

### One answer, two derivations

There are two passes that turn a type into a shape and there have to be: one reads TOKENS, one reads
a checker's `Type`, from different inputs in different processes. What they must never differ about
is the ANSWER — a shape whose spelling depends on whether a build step ran is a document nobody can
diff, and "the second speed only upgrades" stops being true the moment they disagree.

They did disagree, so every decision that turns parts into a schema is made in ONE place
(`compiler/internal/assemble.ts`) and each derivation only supplies the parts: the empty-schema
sentinel, the named formats, the union spelling, how an object and an array are built. A union's
`type` list is SORTED, deliberately — source order reads better to a person and a checker cannot
reproduce it, so the one order both halves can agree on is the one neither of them chose.

`packages/example/test/shapes.test.ts` is what keeps it true: a fixture of types BOTH passes can read,
asserted equal. The server's validator is the one list that cannot be shared — it may import neither
half — so the formats the compiler publishes are asserted to be ones the validator accepts.

### The projection

| Form | Behavior |
| --- | --- |
| `endpoints()` *(`abide/server`)* | Every registered endpoint as `{ id, kind, method, description, streams, input, output }`, sorted by address so two runs of one app produce the same document. |
| `GET /__abide/schema` | The same document over the wire. Open, unlike the log feed: every address in it is already in the client bundle, and the shape beside it is the contract for calling that address. |

An MCP tool is `{ name: id, description, inputSchema: input }` and an OpenAPI operation is the same
three facts under other names, so neither needs a generator in here. What they needed was for the
shape to exist in a form other than a validator.

`dispatch(request, server?)` is the whole server side: it returns `undefined` synchronously for a
path outside `/__abide/`, so an app mounts it in front of its own routes and never thinks about it
again. Everything past that test it runs inside ONE `serve(request, …)`, opened by `dispatch` rather
than by each lane — so an rpc's own slot belongs to the caller that filled it, a socket's `authorize`
has a `request()` and a `trace()` to ask about, and every response including the refusals can name
the operation that answered it. A lane added later gets all three without having to remember to. `websocket` is handed straight to `Bun.serve({ websocket })`. The `server`
argument is what a socket upgrades through, and it is also where `server()` gets its answer: it is
latched before the path is even tested, so every request an app takes makes it answerable — the
argument stays because it is EXACT, and the latch is what a second server in one process cannot be.

## The shared surface

Every `state`, `memo` and `channel` — and therefore `rpc` and `socket` — carries the same verbs and
probes, and **none of them takes arguments**. Arguments select a slot exactly once, at the call:
`m(args)` hands back that slot's cell and everything below is read off the cell. That is why there
is no `peek(args)` / `publish(args, v)` / `chunks(args)` spelling — a slot you have already selected
is just a source, and one vocabulary covers both.

The one place args reappear is on the keyed memo — or the room channel — ITSELF, where they are a
*pattern* rather than a key: `m.invalidate(pattern?)` reaches every slot matching a subset of the
args, and `m(args).invalidate()` reaches exactly one.

`x.watch(handler)` is on every source too; it is in the `watch` section above, with the effect it is
a spelling of, rather than here — it neither causes a change to the source nor observes one.

### Verbs — they cause

| Form | Behavior |
| --- | --- |
| `x.invalidate()` | Discards what is held, and any error, so the next read starts over cold. |
| `x.refresh()` | Recomputes now while continuing to serve what is already held. Needs a body to re-run, so it is on `memo` and a keyed handle, never on a plain `state`. |
| `x.set(v)` | Sets the value directly instead of computing it. A promise is a load and an async iterable is a stream. On anything with a body, the write holds until the next real load replaces it — there is no separate writable-view spelling, because a cell already writes. |
| `x.publish(msg)` | A `channel`'s write — it appends to a stream rather than replacing a value, which is why it is not `set`. |
| `x.dispose()` | Drops a `memo`'s own subscriptions. |
| `invalidate({ tags })` / `refresh({ tags })` | Does the same to everything carrying the tag, on every side that holds it, without the caller knowing which memo that is. |

### Reads — they subscribe, and may start work

| Form | Behavior |
| --- | --- |
| `x()` | The current value, or nothing yet, filling in on its own once it arrives. Throws if the last load failed. On a stream this is the LATEST chunk. |
| `x.chunks()` | Everything a stream has produced so far, in order. A NEW array after each chunk — that is what a reader wakes on — and the same one between chunks, so asking twice does the work once. Empty on a source that never streamed, and the same empty array every time, so a reader of it never wakes for one. The transcript is pushed into and the array is built on the read that follows, so a stream nobody asks for the transcript of pays nothing to keep one; cost is linear in the chunks, not quadratic. |
| `x.peek()` | Exactly what is there right now, subscribing to nothing, starting nothing, and never throwing. |
| `await x` | The settled value. Waits, so it resolves the loaded type rather than "the value or nothing yet". |

### Probes — they only observe

Probes never throw and never start work, so an error is something you ask about rather than
something you catch.

| Form | Behavior |
| --- | --- |
| `x.pending()` | A first load is in flight and there is nothing to show yet. A stream reports this until its first chunk, and `refreshing` after it. |
| `x.refreshing()` | A reload is in flight over a value that is still being served. Its own signal — it never wakes value readers. |
| `x.settled()` | It has finished, however it finished. |
| `x.done()` | It landed, it did not fail, and nothing is still arriving. `streaming` is in that conjunction and `refreshing` is not, and the asymmetry is the point: a warm reload has an outcome already and `done` reports it, while a stream mid-flight has produced none however many chunks it has handed over. |
| `x.streaming()` | It is currently producing chunks. |
| `x.error()` | The failure it ended with, if it failed. |
| `x.isError(e, name)` | Whether a caught failure is the one named — directly, or wrapped as another's `cause`. The NAME rather than the class, because the question outlives the constructor: an error that crossed a wire arrives as a plain object and `instanceof` on it is false however faithfully it was serialised. |

## The caller scope

What a memo's cache belongs to. A module-level `memo` is created once, at import, so on a server its
cache would otherwise outlive the request that filled it — serving the next caller the last one's
data. Per-caller is the default; `{ global }` is how something that belongs to the process says so.

| Form | Behavior |
| --- | --- |
| `isolate(fn)` | Runs `fn` with its own caches and ambients, and drops them when it settles. |
| `serve(request, fn)` | The same, for one request, and what makes the ambients below answerable. |
| `isServing()` | Whether there is a request scope to ask at all — the one probe here, so a shared code path can take the honest branch instead of catching a throw. |

`isolate` is one variable set and put back, so it holds across an `await` but cannot represent two
callers at once — starting a second while an async one is in flight throws. `serve` is async-local
and has no such limit. On a client there is one caller forever, so neither is needed and a memo
behaves exactly as it would with no scope at all.

## Ambient values

Each answers about the caller's own context. Outside a `serve` there is no honest answer to a
request-scoped one, so each of those throws rather than guessing.

| Form | Behavior |
| --- | --- |
| `route()` | The route being served — its name, kind, parameters, URL, and whether a navigation is in flight. REACTIVE, because a client moves without a new caller arriving. |
| `online()` | Whether the caller currently has connectivity. The second REACTIVE one, for the same reason: connectivity changes without a new caller arriving, so an answer only given on the next ask would leave a banner up after the network came back. A server is always online in the only sense the question has — it is not asking whether the process can reach the internet, it is asking whether the caller can reach the thing it is talking to, and a server IS that thing. |
| `identity()` | The principal the server resolved for this caller, never null and never guessed by the client. Always a promise, on both sides, like `health()` — and composed where the caller is being SERVED, fetched anywhere else. |
| `identity({ base, fetch })` | The same `WireOptions` `health()` and `remote` take, and read the same way: an option names a WIRE, a wire is another app, so it is asked over that wire even in a process that could have answered about its own caller. The FIELDS name it rather than the argument. A named wire is asked every time — it is not this page's session, so the client-side cache does not answer for it. |
| `identity.set(claims)` | Authenticate this caller: `claims` are sealed into the `abide-identity` cookie and every response this request builds carries it. Returns a promise — the seal itself is synchronous, but the shape is the same on both sides and it is the room a seal backed by a session store would need. A misconfigured process REJECTS; calling it in a browser throws synchronously, because that is a mistake in the code rather than an outcome of the call. |
| `identity.clear()` | Sign this caller out, for the rest of THIS request as well as the next one. |
| `identity.invalidate()` | Forget what was resolved so the next ask does it again — what a browser calls after the rpc that signed it in. The one verb of the three that is not the server's. |
| `onIdentity(fn)` *(`abide/server`)* | The app's resolver: what the claims that arrived MEAN. Returns the way off again. |
| `trace()` | The identifier tying this work to the operation it belongs to: the inbound `traceparent`'s trace-id, or a fresh one when there is none. W3C Trace Context, because an id abide invented instead would tie this work to nothing. **Nothing to do with `log.debug`**, which is a level — `trace` in this codebase means the W3C context and only that. |
| `trace.span()` | THIS hop's span id, minted per request. What an outbound call and the response name as their parent, and the reason the trace is unbroken across a boundary. abide mints exactly ONE span per hop and models no span tree: a tree is a tracing SDK's job, and the value of Trace Context is that this hands off to a real one cleanly rather than growing a worse one here. |
| `trace.sampled()` | The caller's sampling decision, carried through. abide is not a sampler and never votes — the flags byte propagates verbatim. A trace that STARTS here is `03`: sampled, and flagged random-trace-id, because we did generate it randomly. |
| `trace.state()` | `tracestate`, live and mutable — a `Map`, exactly like `bag()` and `cookies()`, because a third spelling for "a store that lives as long as this request" is a third thing to remember. Untouched, the inbound text propagates byte for byte rather than being re-serialised into an equivalent-but-different string. |
| `trace.headers()` | What an outbound REQUEST carries so the next hop CONTINUES this operation: `traceparent` naming our span as its parent, plus `tracestate` when there is one. This is the whole of how a trace is "added to" — you become the parent, and nothing is appended. Attached automatically by `remote`, so a trace does not stop at the first call; an explicit `traceparent` on `fn.raw(args, init)` is not overruled. |
| `trace.responseHeaders()` | What a RESPONSE carries: `traceresponse`, same four fields, with our span as the parent-id so the caller stitches its span to our entry point. Set automatically on every response abide builds. |
| `request()` | The request being served. |
| `cookies()` | The cookies of the request being served. |
| `bag()` | A bag of values carried for the life of one request. |
| `server()` *(`abide/server`)* | The Bun server that is listening — `requestIP`, `publish`, `pendingWebSockets`, `stop`. Bun hands the instance to `fetch(request, self)` and nowhere else, so anything under the entry point would otherwise be handed it one parameter at a time through code with no other reason to know a server exists. A PROCESS fact like `appDataDir()` rather than a caller's, and answerable from the first request an app takes: `dispatch(request, self)` latches what Bun gave it before it even tests the path, so mounting it IS the wiring. An app that mounts nothing says so once with `server.set(Bun.serve({ … }))`, which returns what it was given. `server.peek()` observes and never throws; `server()` throws before anything has served, like `request()`. |
| `appDataDir()` *(`abide/server`)* | The per-user directory this app may write to, as a PATH. A question about the PROCESS rather than about a caller, so it needs no `serve` — and it is not created here, because `Bun.write` makes the parents of what it writes and a getter that touched the filesystem could throw for a caller that only wanted to print the path. |
| `health()` | The app's own account of whether it is working, as one document — `onHealth`'s fields merged over a baseline abide fills in. Always a promise, on both sides: a call whose return type differed between the lanes would not be one call. |

### The health document

| Form | Behavior |
| --- | --- |
| `health()` | The account of the app this call is IN: composed in the process that is serving, fetched anywhere else. That difference is the whole of what `reachable` reports. |
| `health({ base, fetch })` | The same two options `remote` takes — one `WireOptions`, so they cannot drift. An option names a WIRE, and a wire is another app, so it is asked over that wire even in a process that could have composed an answer itself. The FIELDS name it rather than the argument: `health({})` named no wire and still asks about itself. The request carries `traceparent` like every other outbound call abide builds, so a dependency's account belongs to the operation that asked for it. |
| `onHealth(fn)` *(`abide/server`)* | The app's reporter: fields to merge, sync or async. Returns the way off again. |
| `GET /__abide/health` | The same document over the wire. Open, like the schema catalogue: a health check an operator has to configure a secret into is one that is not wired up on the day it matters. |

| Baseline field | What it says |
| --- | --- |
| `reachable` | Whether the account arrived at all. True by construction where it is composed, and the ONLY field a caller that reached nothing writes down — one that filled in a version for a server that never replied would be inventing the thing it was asked about. |
| `version` | The app's version, off the same package.json its name comes from. Empty rather than absent when nothing declared one, for the reason the log's trace column is empty rather than dropped. |
| `startedAt` | When the process started, ISO-8601. |
| `uptime` | Milliseconds since it did. `performance.timeOrigin` and `performance.now()` are one instant and the count from it, so the two fields cannot disagree — and the count is monotonic, where two `Date.now()` readings step backwards through a clock correction. |

The four are a FLOOR rather than a claim about the app's own dependencies, so an app's fields win
every collision — including `version`, where a build stamp knows something a manifest climb cannot.
The baseline is there so an app that reported nothing still answers something an operator can
correlate a deploy by and tell a restart from a hang with.

A reporter that THROWS is an app saying it is not working, which is the case a health check exists
for — so it does not escape as a throw and take the document with it. The account keeps the baseline
and gains `error: { name, message }`, and the endpoint's status comes off that one field, so an app
that puts one there deliberately says the same thing. It is also written to `abide:health` as a
warning, which the `DEBUG` gate never swallows. A reporter returning something with no fields to
merge — a number, an array — is warned about on the same channel and the baseline stands.

`onHealth` is spelled as a REGISTRATION rather than read off an app's exports because there is no CLI
to read them yet; when there is, it hands the export to this. Its return is the way back off, since a
hook that cannot be removed is one nothing can register twice.

### The principal

A principal is the one ambient abide cannot answer on its own — `trace()` reads a header a standard
defines and `request()` hands back what Bun gave it, but who a caller IS is an app's decision. So the
framework half is deliberately the smaller one: a sealed cookie, and a hook that says what the seal
meant.

| Form | Behavior |
| --- | --- |
| `identity()` | The document. Never null: an anonymous visitor is `{ authenticated: false }`, so a reader asks one question rather than writing the null check half of them forget. |
| the two writers | `set` and `clear` are the SERVER's. They are on the type in both lanes and throw in a browser, because a client that could write its own principal is one that decides who it is — and one call shape with a message beats a property that is missing on one side. |
| `GET /__abide/identity` | The same document over the wire, which is how the browser half asks. Open, and for a stronger reason than the health document: the whole answer is composed from the cookie the caller sent, so a caller can only ever learn about ITSELF and there is nothing to enumerate. `no-store`, because a response that is per-caller by construction must not be cached between here and the browser. |

| Baseline field | What it says |
| --- | --- |
| `authenticated` | Whether this caller presented something the server accepted. The only field a caller that presented nothing carries. |
| `expiresAt` | When the seal lapses, ISO-8601. Absent on an anonymous caller — there is nothing to lapse. |
| `error` | The app's resolver failing. Unlike `health`'s, a document carrying one is never authenticated. |

The seal is an HMAC over the claims and their expiry, and it is not encryption and does not pretend
to be: a browser can READ what it was given — a user seeing their own id is not a leak — and cannot
produce a different one the server accepts. That is what a session cookie actually needs, and it is
why there is no key management beyond one environment variable. The cookie is `HttpOnly` because
nothing in the browser half reads it — it asks the endpoint, which is what the endpoint is for —
`SameSite=Lax` so a cross-site POST cannot ride the session while an ordinary link in still arrives
signed in, and `Secure` in production only, or a development server on `http://localhost` would set a
cookie the browser discards.

A bad signature, a lapsed seal and a malformed cookie are ONE answer — this caller is anonymous.
Telling them apart at the door is how a verifier ends up saying which half of a forgery was right.

Without `onIdentity` the sealed claims ARE the principal, which is the whole of what a small app
needs: `identity.set({ id, name })` and `identity()` hands both back. A resolver is what an app
reaches for when the cookie should carry an id and the principal should carry a row. Its fields win
every collision including `authenticated`, the same rule `onHealth` merges by — a resolver that
authenticates off a bearer header knows something a cookie cannot, and a reserved field would force
that app to publish its answer under a name nothing reads.

A resolver that THROWS is where this parts company with `onHealth`, and deliberately. A reporter that
throws is an app saying it is not working and the health document says so; a resolver that throws is
an app that could not decide who this is, and the only safe reading of that is nobody. It fails
CLOSED: anonymous, with the failure under `error`, and a warning on `abide:identity`.

Resolved at most once per request. What is held is whatever the resolve handed back — the document
when nothing had to wait, the promise when an app's resolver did — so two asks share the one resolve
rather than racing two of them, which for a resolver that hits a database is the whole difference.
The seal is `Bun.CryptoHasher`, which is synchronous, so an app with no resolver answers `identity()`
without a promise in the path at all. Both writers latch what they decided for the REST of the
request: re-reading would answer
with the seal still on the inbound request, which is how a handler that signs somebody in and then
renders shows the previous visitor.

Rolling means a session in use is extended, not that every response carries a `Set-Cookie` — that
costs bytes on all of them and makes each unique to a proxy. The refresh waits until the seal is half
spent, which extends what is in use and leaves an idle session to lapse on schedule.

The cookie reaches a response through `headersFor`, the same funnel `traceresponse` rides, because
the call that decides a login is deep inside a handler and the call that builds the response is
somewhere else entirely.

## Logging

| Form | Behavior |
| --- | --- |
| `log(string)` | Log a message to the console with default channel `<app name>` |
| `log.info(string)` | Info level log |
| `log.warning(string)` | Warn level log |
| `log.error(string)` | Error level log |
| `log.debug(string)` | Debug level log. NOT distributed tracing — see `trace()`, which is the only thing the word `trace` means here. It writes to `console.debug` and `DEBUG` is what gates it, so the name matches both its sink and its gate |
| `log.channel(string)` | Named channel. Prefixed with `<app name>:`. Abide's default is `abide:`. Channel has same log levels, and `.channel()` again appends another segment. The same name hands back the same logger. Gated by `DEBUG` in debug-npm grammar (`abide:*`, `docs:cards,docs:db`, `*`, `*,-abide:*`) — read from the environment on a server and from `localStorage.debug` in a browser |

Two rules decide whether a line is written at all. The DEFAULT channel always writes — it is the app
talking to whoever started it, and an app whose own output needs an env var to appear is an app
nobody reads. A NAMED channel writes only when `DEBUG` names it, because that is what a channel is
FOR. The exception runs in both directions: `warning` and `error` always write, on every channel. The
gate is there to control VOLUME, not to hide breakage, and a failure a missing env var can swallow is
a failure nobody sees — which is also what keeps abide's own `abide:*` channels silent by default
while a hydration mismatch still reaches the console.

A message is one line, and one line is one record: `log(string)` takes a string and nothing else, so
the five fields a machine reads — time, level, channel, message, trace — are the whole shape in every
format, and a tab or a newline inside a message is escaped rather than emitted. The trace is not
something a call site passes; it is the operation the line was WRITTEN in, and it is `null` on a
client and outside a request. It is always present, because a field that appears only sometimes is
one every consumer has to branch on.

| Shape | When |
| --- | --- |
| readable | `<channel> <level> <message> <trace8> +<n>ms`, coloured at a TTY. The delta is since the last line on THAT channel. The trace is the first EIGHT hex — enough to pick one operation out by eye, where 32 on every line is a wall — and the machine formats carry the whole id, so what you paste into an APM is never the truncated one. A browser console is neither a terminal nor a pipe, so it is always this, and never with ANSI in it |
| `tsv` | five tab-separated fields — what a pipe gets unless something says otherwise. Five ALWAYS, empty where there is no trace: a row whose column count depends on whether a request was in flight is one no `cut -f` can read |
| `json` | the same five, named |

`ABIDE_LOG_FORMAT` declares one outright. Unset, the shape follows the TTY, with `NO_COLOR` forcing
`tsv` and `FORCE_COLOR` forcing the readable form off one. `error` and `warning` go to stderr in
every format: that is the one routing decision a pipe cannot make for itself.

### The remote feed

| Form | Behavior |
| --- | --- |
| `GET /__abide/logs` | Every record the ring holds, then every one that arrives next, as one jsonl body that never ends. Served by `dispatch`, so an app that mounted that has it already. |
| `ABIDE_LOGS` | Opts it IN. Closed is the default and a closed feed answers 404 — an app that never opted in has nothing to refuse access to. |
| `ABIDE_LOG_BUFFER` | The ring's size in RECORDS (default `500`). Records rather than bytes, so an operator can reason about it without measuring one. |

The feed is `channel({ tail })` and `ch.tail()` and nothing else: the ring, the cap, the replay and
the live subscribe are all the primitive's, so there is no second retention policy to keep in step
with the one a channel already has.

What it carries is what was WRITTEN — the `DEBUG` gate decides that here exactly as it does at the
console. A tail showing lines the console did not would be a second answer to the same question, and
an operator comparing the two would be right to call one of them broken.

A closed channel costs the gate read and a compare — it rebuilds no channel name and recompiles no
pattern. On a server that read is a property on an ordinary object and is live. In a browser it is
`localStorage.debug`, which is an order of magnitude dearer, so it is held for the rest of the
synchronous run and dropped on the next microtask: a suppressed channel in a loop pays for one read,
and a change made from a console or a click is a later turn and is seen on it.

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

What counts as a cell is decided **syntactically** — `const x = state(…)` or `state.shared(key, …)`
in a `<script>`, or a prop whose declared `Args` member is
`State<…>`/`Memo<…>`/`Cell<…>`/`Channel<…>`. Whether the NAME or the CALL is the source comes from
the same place, and each primitive says it where it can be seen: `memo(() => …)` declares no
arguments so the name is the cell, `memo(({ id }) => …)` does so the call is; `channel<T>()` is one
stream so the name is the source, `channel<T, Args>()` declares rooms in the only place a channel
can — its second TYPE argument — so the call is. (A comma nested inside one type argument is not a
second one.) An **imported** source cannot be seen that way, so it keeps the explicit spelling;
`{count}` alone still renders correctly.

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
| `suspend(value, body, fallback?)` | Emit a placeholder now and the real subtree when the value lands. Inside a `renderDocument`, this defers rather than holding the walk. |
| `opts.hydratable` | Also emit the markers a hydrating client adopts by. Off unless asked for. |
| `mount(container, view)` | Build live DOM and keep it live. Returns `{ dispose }`. |
| `hydrate(container, view)` | The same, over markup a `{ hydratable: true }` render already wrote — every part adopts its range instead of building one. A divergence rebuilds that subtree and warns. |

Every streaming face — `render`, `toStream`, `renderDocument` — is bounded by `ABIDE_SSR_STREAM_BUDGET`
when one is declared, as one clock over the whole render. See Ceilings.

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

## The template runtime

Nine names, and they are the WHOLE set a compiled `.abide` file may import from `abide` on its own
behalf. Each one is ordinary authoring vocabulary too — nothing stops a hand-written template from
calling them, which is what makes "the file you would have written" literally true rather than a
figure of speech.

| Form | Emitted for | Behavior |
| --- | --- | --- |
| `html\`…\`` | every template | The one tagged template both substrates consume. Returns a `TemplateResult`; renders nothing by itself. |
| `raw(s)` | `{html(…)}` | Marks a string as already-HTML so the escape is skipped. The `.abide` spelling is `html(…)` and the runtime spelling is `raw(…)` — the template already owns the name `html`. |
| `keyed(k, t)` | `{#for … by key}` | Tags a row with its identity, so a reconcile MOVES it instead of rebuilding it. |
| `classes(base, …[on, name])` | `class:name={c}` | Merges a static class list and any number of toggles into one attribute value. `null` when nothing survives, so no empty attribute is written. |
| `styles(base, …[prop, value])` | `style:prop={v}` | The same for one style property at a time, into one `style` attribute. |
| `awaited(v, branches)` | `{#await}` | The operand plus the arms to call once it settles. The operand is evaluated by the slot's own effect and the arms are closures, so settling never re-evaluates it. |
| `boundary(body, branches)` | `{#try}` | A synchronous error boundary around a body thunk. |
| `streamed(source, row, catch?)` | `{#for await}` | A list fed by an async source, torn down and re-streamed when a reactive dependency of the source changes. |
| `adopt(scope, css)` | `<style>` | Registers one scoped block by its scope name at MODULE scope. Idempotent, so importing a component twice writes one sheet. |

Everything else on the surface is for a caller doing the rendering rather than a compiled file:

| Form | Behavior |
| --- | --- |
| `escape(s)` | The text escape both substrates use. Probes before it replaces, so text with nothing to escape costs one test. |
| `styleTags()` | Every registered block as its own `<style data-abide="…">`, in registration order — what a server render puts in `<head>` and what `adopt` recognises on the client. One element per scope, because the scope name is the only thing telling a hydrating client which blocks are already there. |
| `classifySlots(strings)` | THE one slot classifier, shared by both substrates so neither is allowed its own idea of what a slot is. Returns a `SlotKind` per hole — `child`, `attr`, `event`, `property`, `ref`, `spread`. |
| `isTemplate(v)` / `isKeyed(v)` / `KEY` | The brands, for a renderer deciding what it was handed. |

A slot inside a tag is one of four sigils or it is an attribute, and that is the whole vocabulary:
`.prop` a DOM property, `@event` a listener, `&ref` the node itself, `...` a spread.

## Script / style blocks

| Block | Scope |
| --- | --- |
| `<script>` | per-instance (component setup). `export` is a compile error — the body is inlined into the setup, so it has nowhere to go |
| `<script module>` | module scope, so `export` belongs here |
| nested `<script>` | branch-local (per-ITEM in a `{#for}`). Must be the FIRST node of a block body — whitespace and comments do not count — carries no `import` (it reuses the component's), and its bindings resolve off the level's `scope`: shadowing inside the branch, invisible outside it. A `{#for}` splices the statements into the row closure it already has; every other body pays one call |
| `<style>` | component-scoped: every element the component writes carries `data-a<hash>`, and every selector requires it on its rightmost compound. Registered once at module scope; `styleTags()` is what a server render puts in `<head>` — one `<style data-abide="…">` per scope, so a hydrating client can see what the document already carries and not append a second copy |
| nested `<style>` | subtree-scoped — an element carries every scope in force, so an outer rule reaches in and an inner one cannot reach out |

## The compiler — `abide/compiler`

One pure function and what a caller needs to REPORT what it did. No filesystem, no resolver, no
cache: `compile` takes text and returns text, which is what lets a demo case assert an emitted file
the same way it asserts a rendered one. The Bun plugin and the check lane are thin shells over it
and neither has any compiling of its own.

| Form | Behavior |
| --- | --- |
| `compile(source, { filename })` | The `.abide` text as `{ code, map, segments }`. `filename` names the default export and every diagnostic. |
| `.code` | The emitted module — the `html` template you would have written by hand. |
| `.map` | A v3 source map with the `.abide` file inlined. |
| `.segments` | The same mapping unencoded, which is what moves a diagnostic back to the source. |
| `originalPosition(segments, position)` | A position in emitted code back to its position in the `.abide` file. |
| `locate(source, position)` | That position as one-based line and column, so an error names a place in the file. |
| `describe(source, filename, error)` | A thrown compile failure as one `file:line:col message` string. Anything else stringifies unchanged. |
| `ParseError` / `ElisionError` | The two classes, so a caller can tell a compile failure from any other throw. A lexer error deliberately is not exported — the shells only format it. |
| `elide(source, { filename, browser, resolve? })` | A transport module for one lane: `{ code, kind, endpoints }`, or `null` for a file under neither transport directory. One pass over one text produces BOTH lanes, so the browser's stub and the server's registration cannot disagree about an address. `resolve` hands over the text of a module a TYPE is imported from — the one thing a single file's tokens cannot supply, and still not I/O this function does. |
| `endpointId(path, name)` / `kindOf(path)` | The address, and which law a module declares. Both are facts about the path. |
| `abide/compiler/plugin` | The Bun plugin: compiles `.abide` on import and elides a transport module, in both lanes, off the same two pure functions. |

Type errors inside a template are reported by the real checker, on the `.abide` line — that is what
`segments` is for, and it is why the compiler owns a mapping rather than only emitting one. Inside a
`<script>` they are reported on the line of the GENERATED module: its imports are hoisted and merged,
so the body no longer lines up with the file and there is nothing to map it by. `remap` marks those
`[generated]` rather than moving them somewhere it cannot justify.

### Typing behaves the way the same TypeScript would

A `<script>` is TypeScript and every position in it is checked as one. What the desugar rewrites is
EXPRESSIONS: a type carries none, so a cell named inside a type is left exactly as the author wrote
it — a `type` alias, an `interface` body, an annotation, `as`/`satisfies`, a type-parameter list and a
type-argument list alike. The `<` ambiguity is resolved the way TypeScript resolves it, by
speculative parse, using the same type grammar that reads a handler's arguments into a schema.

| Form | Checked as |
| --- | --- |
| narrowing | a `{#if}`/`{#switch}` condition reads once into a `const`, so the branch narrows off a real type — and only the switched cell narrows |
| imported types | resolved by the checker across the module boundary, exactly as in a `.ts` |
| generics | a type argument reaches the read; a type-argument list in an expression is a type |
| component props | `type Args` in a `<script>` types them, and is lifted to module scope so the signature can name it. Without one the signature is `Record<string, unknown>`, which checks a caller against nothing |
| writes | `count = v` keeps the cell's type through the `set` it desugars to |

A green typecheck cannot prove any of that on its own: `any` is assignable to everything, so a
desugar that lost a type would still compile. `packages/example/types` is what closes it — the valid
half asserts EXACT types through an identity check `any` cannot pass, and the invalid half is code
that must be REJECTED, with the code and the `.abide` position asserted against real `tsc` output.

## The test kit — `abide/tests`

A demo IS the test and the bench, so there is one place to change rather than three. This is the
shape that makes that hold: a `Case` has three optional faces, and the same object drives `bun test`
headless and the browser card.

| Face | Where it runs |
| --- | --- |
| `run(ctx)` | Headless AND in the browser card. Carries the assertions. |
| `interact(ctx)` | Browser only — buttons and inputs. Skipped by the runner, because a claim that needs a click is a claim no test can make. |
| `bench` | Measurement arms. Smoke-run headless to prove they still run. |

| Form | Behavior |
| --- | --- |
| `suite({ name, title, blurb, cases })` | Identity, and the one place a suite naming nothing is caught. |
| `ctx.host` | The live area — a detached element headless, the card's body in the browser. |
| `ctx.is(label, actual, expected)` | Structural equality. Records the line either way; throws on a mismatch. |
| `ctx.throws(label, fn, match?)` / `ctx.rejects(label, p, match?)` | The two failure assertions, matching a message by substring or pattern. |
| `ctx.log(label, value?)` / `ctx.log.live(…)` | A recorded line; `live` REPLACES the last one with the same label, for a counter that ticks. |
| `runHeadless(case)` | Runs a case the way `bun test` does and returns its lines. |
| `collector()` | A sink that collects instead of rendering — what the headless runner writes into. |
| `loopback()` | `dispatch` and the websocket half, called IN-PROCESS: a `fetch` and an `open` a `remote`/`remoteSocket` can be pointed at, plus the request counter the coalescing claim is made with. A card cannot start a server, and both laws are exercisable without one. |

A bench makes one of four kinds of claim, because the project makes four kinds of claim. None
carries its own prose: the case's `note` IS the claim, so the page and the test cannot drift into
describing two different things.

| Kind | The claim |
| --- | --- |
| `time` | How long an operation takes, as a RATIO against a hand-written arm in the same substrate. The first arm is always abide. `per` divides for a per-row number; `floor: 'flush'` drains the microtask queue so the effect flush is inside the number. |
| `work` | How much DOM work it does. Counted, never timed — the wrong implementation produces the right output at full cost, and only a counter tells them apart. |
| `wake` | How many times a reader RE-RAN. In a reactive system this is the contract, and values cannot show it. |
| `budget` | What the emitted code costs: DOM nodes per list item, microtask turns per row. A number that quietly grows by an order of magnitude is invisible to both a timing and a correctness test. |

The third budget number — JS allocations per template node — is deliberately absent: no engine this
runs on exposes one, so it stays something to read off the emitted code rather than a counter that
would have to lie.

| Form | Behavior |
| --- | --- |
| `install()` | Patches the DOM so the counters see every mutation. |
| `measure(fn)` | The `Counts` a synchronous region caused. `measureFlush` includes the effect flush. |
| `nodesMade(counts)` | Every node the region made — the per-item budget in one number. |
| `total(counts)` | How much the region CHANGED the document, as opposed to what it merely built. |
| `nonZero(counts)` | Only the counters that actually moved, as `label: n` pairs. |
| `timeArms` / `duration` / `ratioText` / `verdict` | The timing half: run the arms, and say whether a ratio is real or inside the noise. |
| `quiesce` / `settled` / `microtasks` / `frame` / `tick` | Waiting primitives, so a bench measures the work rather than the harness. |

## Pages / routing

| Feature | Notes |
| --- | --- |
| `<dir>/**/page.abide` | a route, under the directory handed to `pages(dir)` |
| `<dir>/**/layout.abide` | a layout; renders its child page through `<slot/>` |
| `[name]` | required dynamic segment → `route().params.name` |
| `[[name]]` | optional segment (absent → param omitted) |
| `[...name]` | rest / catch-all (terminal) → the `/`-joined remaining segments |
| precedence | literal > required > optional > rest. Sorted once, at install, so a match stops at the first hit |
| `route()` | `.url`, `.params`, `.name`, `.kind`, `.navigating` — each its own read |
| `url(path, params?, query?)` | build an in-app href. A missing required segment, or a param the pattern has no segment for, THROWS: both are typos every time, and both otherwise point at the wrong page |
| `navigate(target, options?)` | move to one — `{ replace?, keepScroll? }`. Same-route param/query nav = a pure `route()` republish (reads re-fire in place, no DOM swap, no re-hydrate) |
| `routes(table)` | install the app's routes: `{ path, page, layouts? }`, where a page is reached through a LOADER so its code is absent until someone asks for it |
| `outlet()` | the current route's page wrapped in its layouts. Reads the route's NAME and nothing else, which is what makes a same-route navigation patch in place |
| `ready()` | resolve the current route's modules, so the render that follows is a snapshot with nothing left to await. What a server render calls before `renderToString`; `navigate` awaits it for you |
| `pages(dir)` *(`abide/server`)* | a pages directory as a route table — the DIRECTORY is the argument, not a fixed path. The one part of routing that is not isomorphic, because a filesystem is not — what it hands back is the same table `routes()` takes on either side |
| `/__abide/` | all abide controlled endpoints are mounted under `__abide` such as `/__abide/rpc/<path>`

`route()` is a facade over four small cells — name, params, url, navigating — rather than one record,
and every claim above about what a navigation does NOT wake follows from that. A record rebuilt per
navigation is a fresh object every time, so an identity check on it never holds and every reader
wakes for every navigation; it is the same trap `refreshing` avoids by being its own node. `kind` is
derived from the name rather than held, so there is no second record of one fact.

A route is committed only once its page has arrived, which is the whole of what `navigating` reports
— and a navigation to a route already loaded has no in-flight window, so it never sets it.

# Ceilings

Three knobs, one law: **a cap on what is REMEMBERED must not become a cost per write.** They bound
the three places a process grows without anyone deciding it should — a stream's transcript, the memo
cache that belongs to the process rather than to a caller, and how long a streaming render may run.

| Form | Behavior |
| --- | --- |
| `ABIDE_MAX_GLOBAL_CACHE_SIZE` | An LRU byte ceiling over the GLOBAL and default-context memo cache, as one number for the whole process. Unset: no limit. |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | A per-stream transcript ceiling. Passing it drops the transcript for the rest of that stream. Unset: no limit. |
| `ABIDE_SSR_STREAM_BUDGET` | The wall budget for one streaming render. Passing it ends the response as a failure. Unset: no limit. |

All three are read where each could FIRST matter — once per stream, once per settle, once per render
that waits — rather than latched at import. That is what lets an app declare one from its own entry
point, and what makes turning one off actually turn it off: the registry lets go of what it was
tracking on the next settle rather than going on enforcing a number nobody is asking for.

**Unset is the default for all three**, and unset costs one property read at each of those three
moments and nothing on the paths between them — not even the timer the render budget would arm. A
limit chosen for an app abide has never seen is a cache miss, a dropped transcript, or a response cut
off mid-render that nobody asked for.

A byte here is **charged**, not measured, and there are two charges because the two MOMENTS have
different budgets. A slot's runs once, behind a load that already went to a network or a disk, so it
may walk the value. A chunk's runs on every chunk of a stream, so it is O(1) by contract: a string is
charged its length and a binary chunk its `byteLength` — the two shapes a stream actually carries,
both exact — and anything else is charged a flat overhead rather than encoded on the way past. A
charge that had to be exact would be the per-write cost these exist to avoid, and re-measuring what
is held on every write is the O(n²) trap `channel({ tail })` already had to climb out of once.

The cache ceiling is on the CACHE rather than on any memo in it: a per-memo cap is a number an
operator would have to multiply by however many memos an app declares to learn what the process may
hold. Recency comes off the SELECT, since `m(args)` is the one thing every access goes through — a
read, a peek and a probe all start there. It reaches the global and default-context maps and nothing
else, because those are the two that outlive whoever filled them; a per-caller cache is already
bounded by the request that owns it, and evicting from one would answer a memory question nobody
asked with a cache miss inside a live request. An eviction is the CACHE forgetting — whoever already
holds that handle keeps a working cell, and the tag leaves the registry with the slot.

A transcript that overflows is DROPPED rather than trimmed: what overflowed is a replay, and a replay
missing its middle is a hole no reader can see, where an empty one says plainly there is nothing to
replay. The version moves once so a reader wakes for the drop and then sleeps, the cell goes on
holding every chunk that arrives, and the stream still finishes — an overflow disables replay, not
the stream. It is said once on `abide:stream` as a warning, since the `DEBUG` gate controls volume
rather than breakage.

The render budget, once declared, is WALL time rather than per slot: a slot holds the walk for as
long as what it waits on takes, so a page that waits thirty times has no single slot to blame for a
response that never ends — and the whole run is the only number a proxy in front of it is measuring
anyway. It is a timer rather than a poll, because a walk parked on a promise that never settles never
returns to a place a check could live.

It is one clock per RENDER rather than one per walk, because a document render has two phases and
`suspend` lives in the second: given a document to patch it emits a placeholder and defers the real
subtree, so the walk finishes long before the subtree does. Both the in-order walk and the
out-of-order drain race the same clock, and the clock arms itself on the first phase that actually
waits — so a page with nothing to await still costs no timer.

Passing it ABANDONS the walk, the same path a consumer breaking out of `for await` takes, so an
infinite source inside it gets its `return()`. A deferred subtree has no handle to unwind — it is an
independent async function, and a consumer breaking out of the drain already leaves it running — so
what the budget ends there is the RESPONSE. Everything already written has already gone out and the
failure is an `AbideTimeoutError` on the stream: the status line left long ago, so a truncated body
is all HTTP itself has left to say.

# Environment variables

| Name | Purpose |
| --- | --- |
| `PORT` | Listen port (default `3000`). `--port` overrides. `abide dev` hops to the next open port if taken; `abide start` binds directly and fails hard on `EADDRINUSE`. |
| `APP_URL` | Public URL / mount base, and the expected origin both origin gates compare against (WS CSWSH gate, CSRF gate). A `abide dev` port hop carries it to the port actually bound. |
| `NODE_ENV` | Production vs development. Gates the identity-secret requirement and `Secure` on the identity cookie — both built — plus `Strict-Transport-Security` and other prod-only behaviour that is not. |
| `ABIDE_APP_NAME` | The app's own name, and therefore `log`'s default channel. Falls back to the nearest package.json `name` above the working directory — which needs a filesystem, so `abide/server` installs that half — then to `abide`. |
| `ABIDE_DATA_DIR` | Override the per-user data dir backing `appDataDir()`. |
| `ABIDE_IDENTITY_SECRET` | Seals the `abide-identity` cookie. Required in production for `identity.set()` — a development process with nothing declared mints a random key and says so on `abide:identity`, so sessions do not survive a restart, which is exactly what an undeclared secret means. |
| `ABIDE_IDENTITY_TTL` | Identity cookie TTL in ms (default 30d, rolling — re-sealed on the first resolve past half its life). |
| `ABIDE_APP_TOKEN` | Bearer token for the remote CLI & desktop bundle. |
| `ABIDE_APP_URL` | App URL for the remote CLI & desktop bundle (also marks a cross-origin proxy, which then declines to volunteer `traceparent`). |
| `ABIDE_RPC_TIMEOUT` | Default RPC run deadline in ms (default `300000` = 5 min) — a fallback ceiling; per-RPC `timeout` is the real knob. On a handler that yields it is the longest gap BETWEEN chunks. |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Default ceiling on a mutation's request body (unset = no ceiling); per-RPC `maxBodySize` overrides. Over-size declared `content-length` → 413 before buffering. |
| `ABIDE_MAX_GLOBAL_CACHE_SIZE` | Byte ceiling (LRU) for the global + default-context memo cache, as one number for the whole process (default: no limit). Charged per SETTLE, and the select is what says which row is least recently used. See Ceilings. |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | Per-stream transcript cap in bytes (default: no limit; exceeding it drops the transcript and disables replay for the rest of that stream — the cell still holds every chunk). Charged in O(1) per chunk. See Ceilings. |
| `ABIDE_SSR_STREAM_BUDGET` | Total wall budget in ms for an SSR stream (default: no limit). Passing it abandons the walk and ends the response as an `AbideTimeoutError`, with everything written already out. See Ceilings. |
| `ABIDE_LOGS` | Opt IN to the remote log feed (`GET /__abide/logs`, what `./app logs` tails). Default closed → 404. |
| `ABIDE_LOG_BUFFER` | Ring size in records for that log feed (default `500`). |
| `ABIDE_LOG_FORMAT` (`tsv` \| `json`) | Machine log format. Unset, the shape follows the TTY: pretty at a terminal, `tsv` through a pipe. |
| `DEBUG` | Log-channel gating, in debug-npm grammar. Read here on a server and from `localStorage.debug` in a browser; where both exist — a DOM emulator under a test runner — the environment is asked first. |
| `NO_COLOR` | Disable colour everywhere (log lines, CLI banner, REPL banner + ghost text); forces `tsv` log output. |
| `FORCE_COLOR` | Force colour/pretty output even when not a TTY. |

| Export | Signature | Purpose |
| --- | --- | --- |
| `middleware` | `Array<(next: () => Promise<Response>) => Response \| Promise<Response>>` | The per-REQUEST auth/observability rung (onion; `next()` takes no args). Can be short-circuited by a throw or Response. Auth is middleware. |
| `onStart` | `(start: () => Promise<void>) => void \| Promise<void>` | WRAPS the real boot. Do setup, then `await start()` — the socket binds only inside it, so nothing serves until setup finishes. Returning without calling `start()` is a breakout: the app never boots. Awaited. |
| `onStop` | `(stop: () => Promise<void>) => void \| Promise<void>` | Mirrors `onStart` for teardown: drain, then `await stop()`. Backstopped, so teardown still happens if the hook skips it. Runs on SIGINT/SIGTERM/crash. Awaited |
| `onError` | `(error: unknown) => unknown` | Request-scoped; runs when a request throws an UNEXPECTED error. A DELIBERATE outcome never reaches it |
| `onHealth` | `() => unknown \| Promise<unknown>` | Returns fields merged OVER the framework baseline `{ reachable, version, startedAt, uptime }`. It is what `health()` composes into its document on EVERY server-side call. BUILT, and reached as `onHealth(fn)` from `abide/server` until there is a binary to read the export |
| `onIdentity` | `(claims: unknown) => unknown \| Promise<unknown>` | Turns what a caller presented into a principal, merged OVER `{ authenticated, expiresAt }`. Receives `null` for a caller with no valid seal, which is what lets one authenticate off something other than the cookie. Fails CLOSED. BUILT, and reached as `onIdentity(fn)` for the same reason `onHealth` is |

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

# Response helpers

What an app's OWN route answers with (`abide/server`). abide serves `/__abide/**` through `dispatch`
and hands back nothing at all for any other path, so everything else is an ordinary Bun route. Each
helper below returns a plain `Response` and takes a `ResponseInit` the caller's headers ride in — a
route that outgrows one drops to `new Response(...)` and loses nothing.

| Helper | Purpose |
| --- | --- |
| `page` | A rendered document as a response — `text/html`. Takes what a render PRODUCED rather than doing the render, so one helper serves `renderToString`, `toStream` and `renderDocument` without restating their options. |
| `json` | Serialize `data` and tag it `application/json`. `undefined` is not JSON, so a route that answered with nothing sends `null` rather than the literal text `undefined`. |
| `jsonl` | Emit one JSON value per line from a sync or async iterable; `application/jsonl`. Written per `pull`, so back-pressure reaches the source as its own `next()` not being called yet. |
| `sse` | The same machine as `jsonl`, framed as `data: <json>\n\n`; `text/event-stream` + `Cache-Control: no-cache` + `X-Accel-Buffering: no`. |
| `redirect` | NAVIGATE. The status is restricted to the 3xx literals (`301`/`302`/`303`/`307`/`308`, default `302`) — a type here rather than `Response.redirect`'s runtime `RangeError`, and unlike it there is an `init`, which is where a login's cookie goes. |
| `error` | Throws an `HttpError` (`status`, `kind`) rather than returning one, because a handler's return type is its VALUE and a failure has nowhere else to go; declared `never`, so the checker treats the next line as unreachable. `error.typed(name, status)` builds a reusable factory for a named, narrowable failure, and its name rides on `kind` — carried as the error's `name`, which is what crosses the wire and what `fn.isError(e, name)` matches. |

Every response built through one of these carries `traceresponse` — they share one header helper, so
the rpc wire and every refusal `dispatch` writes get it too. A failure is the response you most want
to correlate. Outside a request the header is absent rather than carrying an id for an operation that
does not exist, and a caller that set its own is not overruled.

A source that throws mid-`jsonl`/`sse` ERRORS the body: the status line is already out, so a truncated
response is all HTTP itself has left to say. The rpc lane's `application/x-ndjson` stream is the same
machine with one extra frame — it has a decoder on the other end, so it says the failure in a line.
