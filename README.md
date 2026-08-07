# abide

A minimal isomorphic framework in abide's lineage: three primitives, one template tag, two
substrates — and a `.abide` compiler built on TypeScript 7's own scanner, emitting the file you
would have written by hand.

A bun workspace: `packages/abide` is the framework, `packages/example` is the dogfood.

Lines are CODE lines — comments and blanks excluded — because this file is heavily commented and
counting the prose would be counting the wrong thing.

```
packages/abide/src/
  shared/               the isomorphic half — same import, same call, both sides
    internal/graph.ts   589   the reactive engine: state / derive / watch / untrack / scope, and
                              the three shapes a value arrives in — value, load, stream
    memo.ts             322   memo(load) — args-keyed cache, coalescing, probes, ttl, pacing
    channel.ts          191   channel — pub/sub with a reactive read surface, rooms, maxAge, tail
    router.ts           324   route/url/navigate/routes/outlet — the route as four cells, per caller
    internal/patterns.ts 162  a pattern: parse it, order it, run a path through it
    html.ts             147   the template tag + THE one slot classifier
    internal/{slots,tags,keys}.ts  101   the slot cache, the tag registry, the args key
    transport.ts        341   remote / remoteSocket — the client half of both laws: a keyed memo
                              with a fetch for a body, a channel with a websocket for one
    internal/trace.ts    12   where the isomorphic half asks about the current trace: the id for a
                              log line, the headers for an outbound call. null on a client
    internal/wire.ts    176   what goes over the wire: one value, a stream of them, a failure — and
                              a FILE, which travels beside the args with a reference where it sat
    internal/shapes.ts   39   JsonSchema — the one shape language, so the compiler and the runtime
                              cannot disagree about what a declaration means
    internal/env.ts      22   what the process was told, and whether its stdout may carry ANSI —
                              apart from log.ts so `abide --help` need not load a logger to ask
    log.ts              214   log — channels, levels, the DEBUG gate, and the three shapes a line
                              takes: readable, tsv, json — rendered where `abide logs` can reach it,
                              so a tailed record and a written line cannot look different
    internal/ceilings.ts 96   the three caps a process runs under — a stream's transcript, the
                              global memo cache's LRU, an SSR render's wall budget — and the charge
                              they are measured by: O(1) per chunk, and a walk per settle
    online.ts            10   online() — the second reactive ambient, off the platform's own events
    health.ts            40   health() — the app's own account: composed in the process that serves
                              it, fetched anywhere else, which is what `reachable` reports
    identity.ts          84   identity() — the principal, composed where the caller is served and
                              fetched anywhere else. Never null, and the two writers are the server's
    reactive.ts + index.ts          44   the public faces
  ui/                   the DOM renderer — parse-once templates, per-slot effects, keyed lists
    internal/parts.ts   686   child parts, keyed lists, instances
    internal/prepare.ts  92   parse once per call site
    index.ts             30   mount · hydrate
  server/               streaming SSR, the transport's declaring half, in-order + out-of-order suspend
    index.ts            491   the walk and the document, both phases racing one wall budget from
                              ceilings.ts when an operator declares one
    pages.ts             54   a pages directory as a route table — routing's one non-isomorphic half
    internal/emit.ts     26   attributes, the patch script
    rpc.ts              316   GET…DELETE and socket — the DECLARING half: middleware, timeout,
                              retention, the cross-origin gate, the declared shapes, and one call
                              as a Response
    schema.ts           325   the three forms a shape is declared in, and the validator for the
                              native one — JSON Schema, which is what a declaration MEANS
    registry.ts         288   dispatch — id -> handler, the request scope every lane is served in,
                              the websocket half of the mount point, and endpoints(): the whole API
                              as the document a machine reads before calling one
    running.ts           20   server() — the Bun server that is listening, latched where Bun hands
                              it over, so nothing under the entry point has to be threaded it
    logs.ts              21   GET /__abide/logs — the remote feed, which is one channel and its tail
    health.ts            66   onHealth + GET /__abide/health — a baseline abide fills in, the app's
                              own fields over it, and a reporter's throw as an account rather than one
    identity.ts         182   onIdentity + GET /__abide/identity — the HMAC-sealed cookie, the
                              resolver over it, and a rolling refresh that fails CLOSED on a throw
    scopes.ts           189   serve — the async-local caller scope, request/cookies/bag, the cookies
                              a response writes back, and the whole W3C trace context: id, our span,
                              flags, tracestate, both headers
    responses.ts         78   page · json · jsonl · sse · redirect · error — and the one header
                              helper that puts traceresponse on every response abide builds
    app.ts               54   the two things that need a filesystem: package.json (name and the
                              version the health document publishes), appDataDir()
packages/abide/compiler/  the `.abide` compiler — TypeScript 7's own scanner, so a template
                          expression is the same language as the rest of the file
    internal/lex.ts        the one tokenizer: where an embedded expression ENDS
    internal/desugar.ts    reads and writes by name, with shadowing tracked
    internal/parse.ts      the file -> a node tree
    internal/emit.ts       the node tree -> the `html` template you would have written
    internal/css.ts        scoped <style>: one attribute, selectors rewritten
    internal/elide.ts      a transport module -> the stub, or the module plus its own address
    internal/shape.ts      a handler's TYPE -> JSON Schema, so a declaration says its shape once
    internal/types.ts      which tokens ARE a type, so the desugar rewrites expressions and nothing
                           else — same grammar as shape.ts, because two would disagree
    shapes.ts              the second speed: the real checker over a whole project, for the types
                           tokens cannot read. Optional, and only ever an upgrade
    internal/checked.ts    its Node half — Type -> JSON Schema, knowing nothing about abide
    internal/assemble.ts   the one place a schema is ASSEMBLED, so the two derivations above cannot
                           answer the same type two ways
    index.ts               compile() + elide() — pure, no I/O
packages/abide/cli/     the `abide` binary — the table IS the help, and a command's number is the
                        exit code
    COMMANDS.ts          53   the whole surface as data: the rows the usage screen is generated
                              from, and the lazy body each one dispatches to
    CLI_EXIT_CODES.ts    21   0 ok · 1 unreachable · 2 usage · 3 422 · 4 401/403 · 5 404 · 6 504
    internal/repl.ts    275   the prompt: node:vm so a `const` survives the line, Bun.Transpiler so
                              the language decides when one has finished, and a source printed as
                              what it holds
    internal/editor.ts  176   one line and the ghost of what it could be — its own editor, because
                              drawing after the cursor means owning the repaint
    internal/logs.ts    100   the tail — a never-ending jsonl body, printed by log.ts's own line
                              rules, so a tailed record and a written line cannot look different
    internal/run.ts      14   a script under the `.abide` loader, spawned so its argv is its own
    internal/check.ts     8   the checker over a project, which is compiler/check.ts's already
    internal/paint.ts     8   the four ANSI codes, over env.ts's one answer about whether they may
                              be written — so NO_COLOR is one promise rather than three
    index.ts             22   argv in, exit code out
packages/abide/tests/   the test kit (abide/tests): the Case shape, assertions, DOM counters, bench timing
packages/example/types/ the typing contract: `valid/` asserts EXACT types, `invalid/` is code that
                        must be REJECTED — checked by real tsc in `test/types.test.ts`
```

## `.abide`

A file is markup with `{expr}` holes, control-flow blocks and `<script>` / `<style>` blocks, and it
compiles to an ordinary module — the same shape `packages/example/app.ts` is by hand. Cells are read
and written **by name**:

```abide
<script>
const count = state(0)
</script>

<p class:high={count > 2}>count {count}</p>
<button onclick={() => count++}>increment</button>
```

```ts
export default function Counter(args: Record<string, unknown>): TemplateResult {
    const count = state(0)
    return html`
<p class=${() => classes("", [count() > 2, "high"])}>count ${() => count}</p>
<button @click=${() => count.set(count.peek() + 1)}>increment</button>`
}
```

`packages/example/app.abide` and `packages/example/app.ts` are the same component written twice, and
the `compiler` demo suite asserts they render identically on both substrates. Two rules carry the
rest:

- **Naming a cell alone hands over the cell; using it in an expression reads it.** That is what
  `bind:value={x}` and a component prop need, and a slot renders it as its value anyway.
- **Shadowing is tracked.** `items.map((count) => count)` is left alone even when an outer `count`
  cell exists — the one way this could be silently wrong.
- **A condition narrows its branch.** Every read is a *call*, and TypeScript narrows a `const` but
  never a call — so `{#if session}{session.name}{/if}` had no way to typecheck. A condition reads
  once into a local and the branch narrows off it, which also costs less: separate reads subscribe to
  the same cell twice and both wake on a change, where one hoisted read wakes the branch once.

The explicit `count()` / `count.set(n)` spelling always compiles; this is sugar over it. What a cell
IS is decided syntactically, so there is no type-checker in the emit path and the JavaScript lane
compiles too — the cost is that an *imported* cell keeps the explicit spelling.

A `<style>` block is **scoped without a runtime**: every element the component writes carries a
`data-a<hash>` attribute (static markup, free at render) and every selector gains that attribute on
its *rightmost* compound — so `main p` still reaches in from outside while nothing inside reaches
out. The rules register once at module scope, which is what lets a server render put the whole sheet
in `<head>` without tracking which components it happened to reach. A **nested** `<style>` is the
same machine pointed at fewer elements: one more attribute on the nodes it sits among and their
descendants, so an element carries every scope in force and the containment is asymmetric on purpose.
Blocks are content-addressed, so two spelling the same rules are one sheet and one attribute.

Type errors inside a template are reported by the real checker, **on the `.abide` line**.
`abide check` — which is what `bun run typecheck` runs — writes the compiled module, a `.d.abide.ts`
(which is what `allowArbitraryExtensions` makes `tsc` resolve `./app.abide` to) and a v3 source map
beside each file, runs `tsc`, and moves every diagnostic back:

```
packages/example/demos/fixtures/bad.abide(7,9): error TS2339: Property 'nmae' does not exist on …
```

Every copied expression is emitted behind an invisible marker and one pass over the finished string
lifts the markers into the map — so no generated position had to be threaded through the emitter. The
line is exact; the column drifts within an expression by however much the desugar inserted. Everything
generated is gitignored: the `.abide` file is the source.

## The model

Three primitives, isomorphic — same import, same call, both sides:

| | |
| --- | --- |
| `state(initial, transform?)` | **own** a value. Callable: `x()` reads, `x.set(v)` writes, `x.peek()` reads untracked. A promise is a *load* and an async iterable a *stream* — see below. `state.shared(key, …)` is one cell per key rather than per call site. |
| `memo(body, transform?, opts?)` | **derive or load** one. |
| `channel(opts?)` | **subscribe** to them. |

`memo` is one name with two forms, split by whether the body **declares inputs** — abide's rule
verbatim, which is why there is no separate `resource`/`asyncMemo`:

```ts
const doubled = memo(() => count() * 2)                 // no args -> deps inferred from the body
const search  = memo(async ({ q }) => fetchIt(q))       // args    -> the args ARE the cache key
```

Both forms take the same options (`ttl`, `tags`, `global`, `throttle`, `debounce`) and carry the
same verbs. Declaring inputs decides where the cache key comes from, and nothing else — so
`refresh`, `invalidate` and `set` are spelled the same on an argless async memo as on a keyed one.

`throttle` and `debounce` pace **explicit revalidation of data already on screen**: a cold slot has
nothing for a window to protect, so its first load still runs in the call, and a read that finds a
slot cold never comes through the window at all.

A second argument that is a **function** is a `transform`: the body declares the dependencies and
the transform, which runs untracked over whatever the body produced, shapes the answer.

```ts
const names = memo(() => rows(), (all) => all.map((r) => r.name))
```

The load form's call **selects a slot** and hands back its **handle** — which is a cell, so it needs
no vocabulary of its own. The args address the slot once, at the call:

```ts
search({ q })              // the handle. Selecting costs nothing and starts nothing
search({ q })()            // read: subscribes, kicks a cold load, throws if the last one failed
await search({ q })        // wait for the settle — this is how the server reads one
search({ q }).peek()       // retained, subscribing to nothing, starting nothing, never throwing
search({ q }).pending()    // …and refreshing / error / settled
search({ q }).set(v)       // a local write, held until a real load replaces it
search({ q }).invalidate() // per key
search.invalidate()        // every slot at once
```

The bulk verbs take a **pattern** — a subset of the args, matched the same way slots are keyed. One
slot is `m(args).invalidate()`, so the memo-level verb is free to mean "every slot that matches"
without the two spellings ever being confused:

```ts
page({ team: 'core', n: 2 }).invalidate()   // exactly this slot
page.invalidate({ team: 'core' })           // every page of core
page.invalidate()                           // every slot
```

`invalidate` and `refresh` differ on two axes at once, and the names carry both:

| | `invalidate()` | `refresh()` |
| --- | --- | --- |
| the claim | this data is **wrong** | this data may be **stale** |
| retained value | **dropped**, error cleared | **kept**, served while the reload runs |
| the reload | starts nothing — the next read pays | runs **now**, no reader needed |

So you `invalidate` after a logout or a delete, where showing the old value would be showing a lie,
and `refresh` after a mutation or on a poll. (A slot that is on screen has a live reader, and a read
kicks whenever it finds the slot cold — so invalidating a *watched* slot does reload, via the reader
waking. The visible difference is the middle row: `invalidate` flashes blank, `refresh` doesn't.)

**A probe observes; it never causes** — and that is why the *read* kicks the load rather than the
call. If selecting a slot started work, there would be no way to ask anything about a key without
starting work on it, and `peek`/`pending` on a cold slot would stop being questions. The two members
that ask for the value, `()` and `await`, are the two that start one.

### Tags

A tag names **data**, not the thing holding it, so the verbs that take one are module-level: they
reach every slot carrying the tag without the caller knowing which memo that is.

```ts
const user = memo(({ id }) => fetchUser(id), { tags: ({ id }) => [`user:${id}`, 'account'] })
const post = memo(({ id }) => fetchPost(id), { tags: ['account'] })

invalidate({ tags: ['user:42'] })        // one row, wherever it lives
refresh({ tags: ['account'] })           // both memos, without naming either
invalidate({ tags: ['account'] }, user)  // scoped to one memo's slots
```

`tags` as a **function of args** is what lets a tag name one row rather than every row a memo holds
— `user:42` instead of "users". A target carrying two of the named tags is acted on once.

### The caller scope

A module-level `memo` is created **once**, at import, so its cache lives as long as the process. On a
client that is exactly right — there is one caller, forever. On a server it means the answer computed
for one request is served to the next one, which is not a stale cache, it is the wrong person's data.

So a memo's cache is **per-caller by default**, and `{ global }` is how something that genuinely
belongs to the process says so:

```ts
const profile = memo(({ id }) => load(id))                     // per caller
const rates   = memo(({ pair }) => fetchRates(pair), { global: true })  // one cache, whole process

serve(request, async () => profile({ id }))   // a server: async-local, requests interleave freely
isolate(() => profile({ id }))                // a client, a test, a script: one variable
```

`serve` also makes the request-scoped ambients answerable — `request()`, `bag()`, `cookies()`,
`trace()` — and each throws outside one rather than guessing.

`trace()` is W3C Trace Context, and it is **not** `log.debug`: the word means the distributed-tracing
context here and only that, which is why the log level that used to be called `trace` is not. abide
mints exactly **one span per hop** and models no span tree — a tree is a tracing SDK's job, and the
value of Trace Context is that this hands off to a real one cleanly rather than growing a worse one.

```ts
trace()                    // the trace id — the OPERATION
trace.span()               // this hop's span, minted per request
trace.sampled()            // the caller's decision, carried. abide never votes
trace.state()              // tracestate, a live Map — like bag() and cookies()
trace.headers()            // OUTBOUND: traceparent naming our span as the parent
trace.responseHeaders()    // traceresponse, so a caller stitches its span to ours
```

Three things fall out of having a span of our own, which is what was missing: an outbound `remote`
call carries `trace.headers()` automatically, so a trace does not stop at the first hop; every
response abide builds carries `traceresponse`, because they share one header helper; and every log
line carries the operation it was written in — full id in `tsv`/`json`, first eight hex on a
terminal, `null` on a client and outside a request. None of that is something a call site passes. Three ambients answer *without* a request, because none of them is about a caller: `online()`,
which is reactive off the platform's own `online`/`offline` events and always true on a server — it is
not asking whether the process can reach the internet — `appDataDir()` from `abide/server`, the
per-user path this app may write to, as a path and nothing else, and `server()` from the same place,
the Bun server that is listening. Bun hands that to `fetch(request, self)` and nowhere else, so
`requestIP` or `publish` three layers down means a parameter threaded through code with no other
reason to know a server exists; `dispatch(request, self)` latches it, and an app that mounts nothing
says so once with `server.set(Bun.serve({ … }))`. The argless form is scoped too, which matters because a `GET(() =>
…)` with no arguments is exactly the leaky case; having no args key means the **cell** is what varies,
so that form is handed back as a facade over "whichever cell belongs to the caller asking". The keyed
form needs none of that: its cache is already a map, so scoping it is choosing a different map.

**A client pays nothing for any of this.** `currentScope()` reads a variable a browser never writes,
so the facade forwards straight through — the scope suite benches that arm against `{ global }`, which
is the same memo with no facade at all.

### Routing

A URL names a page, and `route()` is what that page may ask about the caller who asked for it. It is
an ambient like `request()` — and the one that has to be **reactive**, because a client moves without
a new caller arriving.

```ts
routes([
    { path: '/', page: () => import('./pages/page.abide') },
    { path: '/users/new', page: () => import('./pages/users/new/page.abide') },
    {
        path: '/users/[id]',
        page: () => import('./pages/users/[id]/page.abide'),
        layouts: [() => import('./pages/layout.abide')],
    },
    { path: '/files/[...path]', page: () => import('./pages/files/[...path]/page.abide') },
])

route().name       // '/users/[id]' — the PATTERN, so it is stable across every URL matching it
route().params.id  // '42'
route().url        // the whole URL, query included
route().navigating // a page whose module has not arrived yet

url('/users/[id]', { id: 42 }, { tab: 'posts' }) // '/users/42?tab=posts'
await navigate('/users/43')
```

Precedence is **literal > required > optional > rest**, and the table is sorted once at install, so a
match is a walk that stops at the first hit rather than a score kept over every route.

`route()` is **four small cells behind a facade, not one record**, and every property is its own read:

| | `/users/1` → `/users/2` | `?tab=a` → `?tab=b` |
| --- | --- | --- |
| a reader of `route().name` | asleep | asleep |
| a reader of `route().params.id` | wakes | asleep |
| a reader of `route().url` | wakes | wakes |

So a same-route navigation is a **republish**: `outlet()` reads the name and nothing else, so it does
not re-run at all, and the page's own reads re-fire in place — no DOM swap, no re-hydrate. One record
rebuilt per navigation cannot express a single row of that table: it is a fresh object every time, so
the identity check never holds and everybody wakes. The bench counts it against exactly that
hand-written arm, because the values on screen are identical either way.

Three more rules fall out of it:

- **A route is committed only once its page has arrived**, so nothing ever renders a page that is not
  there. That is the whole of what `navigating` reports — and a navigation to a route already loaded
  has no in-flight window, so it never sets it and never wakes a spinner for nothing.
- **The route is per-caller**, through the same storage a memo's cache uses. A server answers two
  visitors at two URLs at once; on a client there is one caller forever and it costs a null check.
  It is also what decides whether `navigate` writes to the address bar: a request being served, or a
  test driving a route on the side, has a scope, and a browser app is the only thing that does not.
  The address bar itself arrives from `abide/ui`, which is the package that owns the DOM — routing
  keeps the rule and neither lane's edge, so nothing shared has to guess which one it is running in.
- **`url()` refuses to build a wrong href.** A missing required segment, and a param the pattern has
  no segment for, are typos every time, and both otherwise link to the wrong page.

The **directory is the pattern and the filename is the kind**: `pages(dir)` hands back the
table above, with every `layout` above a page attached outermost-first. That half lives in
`abide/server`, because a filesystem is not isomorphic; what it produces is the same ordinary table
`routes()` takes on either side.

### Transports

Two laws over the primitives, and the whole of both is that the right-hand side is already written:

```ts
// server/rpc/users.ts — the DIRECTORY is what makes this an endpoint
import { GET, POST } from 'abide/server'
import { findUser, renameUser } from '../db.ts'

export const getUser = GET(({ id }: { id: number }) => findUser(id))
export const rename  = POST(({ id, name }: { id: number; name: string }) => renameUser(id, name))
```

```ts
// anywhere — the same import on both sides
import { getUser } from './server/rpc/users.ts'

await getUser({ id: 7 })       // the value, wherever this is running
getUser({ id: 7 }).peek()      // …and every other thing a keyed memo's handle answers
```

An `rpc` **is** a keyed `memo` whose body happens to be a fetch, so nothing about the surface is
transport-shaped, and **three concurrent readers of one key cost one request** because the *slot*
coalesces — exactly as it already did for a local load. A `socket` is a `channel` whose subscribers
arrived over a wire; the server half is `channel()` unchanged, and the entire transport is one
`subscribe` on upgrade and one unsubscribe on close.

- **The directory is the kind.** `server/rpc/**` is an rpc and `server/sockets/**` is a socket. A Bun
  plugin filter is a *path* regex, so a `'use server'` directive would mean intercepting every `.ts`
  in the graph; a path costs one regex and tells the plugin which stub to write before it reads the
  file. A `socket` under `server/rpc/` is a compile error naming the file, the export and both.
- **An endpoint is recognised syntactically** — `export const NAME = GET(…)`. The same rule `.abide`
  lives by, for the same reason: the browser lane builds the stub from a file it is about to throw
  away, so the emit path must not need a type-checker. Any other export there is a compile error
  naming the export, because the alternative is a stub exporting `undefined` for a helper somebody
  imported.
- **The module's own path is the address**, under one reserved prefix: `server/rpc/admin/audit.ts`'s
  `recent` is served at `/__abide/rpc/admin/audit/recent`. No hash — the filesystem already forbids
  two files at one path, and an address legible in a network panel is worth the bytes.
- **The browser gets the address and none of the body.** The server gets the module verbatim with a
  `register(…)` appended, so every line keeps its number and a stack trace still points at the
  handler.
- **`dispatch(request, server?)` is the whole server side.** It returns `undefined` synchronously for
  anything outside `/__abide/`, so an app mounts it in front of its own routes and forgets it, and it
  runs each handler inside `serve(request, …)` — so an rpc's slot belongs to the caller that filled
  it. It also latches the server Bun handed it, before it even tests the path, which is what makes
  `server()` answerable from a handler that was threaded nothing.

### One surface on every source

| | `state` | `memo` (derive) | `m(args)` handle | `channel` |
| --- | --- | --- | --- | --- |
| `x()` read, `x.peek()`, `x.chunks()` | ✓ | ✓ | ✓ | ✓ |
| `pending` / `refreshing` / `error` / `settled` | ✓ | ✓ | ✓ | ✓ (always cold) |
| `streaming` / `done` | ✓ | ✓ | ✓ | ✓ (always `true` / `false`) |
| `x.isError(e, name)`, `x.watch(handler)` | ✓ | ✓ | ✓ | ✓ |
| `x.set(v)` | ✓ | ✓ | ✓ | `publish` |
| `x.invalidate()` | ✓ | ✓ | ✓ | ✓ |
| `x.refresh()` | — | ✓ | ✓ | — |
| `await x` | ✓ | ✓ | ✓ | — |

`refresh` is the one verb that isn't universal: re-running requires a body to re-run, and a `state`
has none. The spec's "every source carries every verb" does not survive contact with that, so the
rule here is narrower and true — **`invalidate` needs only data, `refresh` needs a body.**

A channel answers the rest of the surface honestly rather than uniformly: it never loads, so the
load probes are the cold answer, and its stream has no end, so it is always `streaming` and never
`done`. `channel<T, Args>()` splits it into rooms — `ch(args)` selects one and hands back an
ordinary channel, the way `m(args)` hands back a slot — and `{ maxAge }` makes a message current
only while it is young, waking readers when it stops being.

### Logging

`log` is isomorphic like everything else here — same import, same call, both sides — and the two
lanes differ only in where the gate is read from and what a line is allowed to look like.

```ts
import { log } from 'abide'

log('the app started')            // the app's own channel. Always writes.
const cards = log.channel('cards')  // `<app name>:cards`. DEBUG=docs:cards, or docs:*, or *
cards('rendered 12 rows')           // silent until somebody asks for it
cards.debug('12 rows, 3ms')         // the finest LEVEL. not tracing — see trace() above
cards.warning('one row had no id')  // not silent. Ever.
```

Two rules, and the exception is the interesting one:

- **The default channel always writes.** It is the app talking to whoever started it, and an app
  whose own output needs an env var to appear is an app nobody reads.
- **A named channel writes only when `DEBUG` names it**, in the debug-npm spelling everyone already
  knows — `docs:cards,docs:db`, `docs:*`, `*`, `*,-abide:*`. On a server that is the environment; in
  a browser it is `localStorage.debug`.
- **Except `warning` and `error`, which are never gated, on any channel.** The gate exists to control
  volume, not to hide breakage. That is what lets abide keep its own `abide:*` channels silent by
  default while a hydration mismatch still reaches the console — and the framework's root stays
  `abide` however the embedding app is named, so the two namespaces cannot be confused.

A message is a string and a line is one record, so the five fields a machine reads — time, level,
channel, message, trace — are the whole shape in every format. `ABIDE_LOG_FORMAT` declares one; unset, the
shape follows the terminal: readable with `+12ms` deltas and colour at a TTY, `tsv` through a pipe. A
browser console is neither, so it is always the readable form and never carries ANSI. `error` and
`warning` go to stderr in every format — the one routing decision a pipe cannot make for itself.

A channel nobody turned on costs the gate read and a compare, which is what makes one safe to leave
in the code. On a server that read is a property on an ordinary object. In a browser it is
`localStorage.debug` — 225 ns against 15 ns for an ordinary property, measured in Safari, and the
whole of what a suppressed call costs there — so it is held for the rest of the synchronous run and
dropped on the next microtask. A loop pays for one read; a change typed into a console is a later
turn and is still seen on it. Reading once at import, which is what debug-npm does, would be faster
again and would mean reloading the page to change anything.

The same lines are readable from off the box at `GET /__abide/logs` — `dispatch` serves it, so an app
that mounted that has it already. It is **`channel({ tail })` and nothing else**: the ring, the cap
and the live subscribe are the primitive's, so the endpoint is a replay of `chunks()` followed by a
`subscribe`, taken in one synchronous run because a line published between the two would otherwise be
missed by the one and dropped by the other. `ABIDE_LOGS` opts it in — closed is the default, and a
closed feed answers **404**, not 403: an app that never opted in has nothing to refuse access to.
`ABIDE_LOG_BUFFER` sizes the ring in records (default 500). What it carries is what was *written*,
gate included: a tail showing lines the console did not would be a second answer to the same
question.

`abide logs` is the client for it, and what crosses is a **record** rather than a rendered line — so
the tail prints by the rules *its own* stdout answers to. Piped, that is `tsv`; on a terminal it is
the readable form, colour and all, with the `+12ms` delta rebuilt from the times the records carry
rather than from when this process happened to read them. A replayed ring therefore shows the spacing
the app actually wrote at. The formatting itself is `log.ts`'s, called from the CLI: two copies of
those rules is exactly the drift the feed exists not to have.

## Sync or async is not a different spelling

A cell holds a **settled value**. Handing one a promise starts a *load* instead of storing the
promise, so the read is the same call either way — that is the whole rule, and it applies to `state`
and to both forms of `memo`:

```ts
const session = state(fetchSession())        // a promise is a LOAD, not a value
session()                                    // undefined, then the session — same call as always
const name = memo(() => session()?.name)     // derive off it with the ordinary sync spelling

const user = memo(async () => load(id()))    // argless + async: deps are the ones read BEFORE
                                             // the first await — all tracking can honestly see
await user                                   // every cell is thenable, which is how SSR reads one
```

Every cell answers the same async surface, and a purely sync one answers it honestly (`settled()`
true, `pending()` false, `await x` already resolved):

| | |
| --- | --- |
| `x()` | the settled value, retained across a re-load. **Throws if the last load failed** |
| `x.peek()` | the retained value, subscribing to nothing and never throwing — the escape hatch |
| `x.chunks()` | everything a stream has produced, in order. Empty, and identity-stable, on a cell that never streamed |
| `x.pending()` | a **cold** load — nothing retained to show |
| `x.refreshing()` | a load **over** a retained value; its own signal, so it never wakes value readers |
| `x.streaming()` | chunks are still arriving |
| `x.error()` | the last rejection. Probes never throw |
| `x.settled()` | has a value or an error ever landed |
| `x.done()` | it landed, it did not fail, and nothing is still arriving |
| `x.isError(e, name)` | is a caught failure the one named — by NAME, through `cause`, so it survives a wire |
| `x.watch(handler)` | react to it without reaching for `watch`; the handler is untracked, since the source you asked IS the declaration |
| `await x` | the settled value; rejects if the load did |

**A failed load throws from the read**, in every form — `x()` for a cell, `search({q})()` for a
slot. Reporting `undefined` instead lets a caller who never checked `error()` render as though
nothing went wrong. The failure does not destroy the retained value: `peek()` still serves it, which
is how a UI shows stale data next to an error. Inside a `watch` the throw is caught per node and
rethrown from a fresh microtask, so one failed cell never strands the rest of the batch.

The bookkeeping is allocated on first contact with a promise or a probe, so a cell that only ever
holds sync values still costs exactly one node, as it always did.

**An async iterable is a STREAM**, by the same law and through the same members. The cell holds the
latest chunk, `chunks()` holds the transcript, and the probes compose rather than needing a
vocabulary of their own — `pending` until the first chunk, then `refreshing` over a value already
being served, `streaming` throughout, and `done` only once it ends cleanly.

```ts
const line = state<string | undefined>(undefined)
line.set(tokens())      // an async generator
line()                  // the latest chunk; line.chunks() is all of them so far
await line              // resolves when the stream ENDS, with the last chunk
```

Three rules fall out of "a promise is a load":

- **The newest write wins**, even when an older load settles after it — every adoption carries a
  generation stamp and a stale settle is dropped. Without it a slow first load lands on top of the
  fast second one, which is the classic type-ahead bug.
- **A sync write cancels an in-flight load.** It is the newer answer.
- **A sync body settles in the call.** `memo(({id}) => id * 2)` is readable on the very first read:
  no `pending` flash, no microtask, no wake-up a tick later to correct an `undefined` nobody should
  have seen. The promise wrapper is the fallback path, not the default.

## Templates

One `html` tag, consumed by both substrates. `${}` in child position is content; inside a tag it is
a whole attribute value, written unquoted:

```ts
html`<a href=${url} class=${() => cls()} @click=${onClick} .value=${() => text()}>${label}</a>`
```

| Spelling | Meaning |
| --- | --- |
| `name=${v}` | attribute — `null`/`undefined`/`false` omit it, `true` makes it bare |
| `@event=${fn}` | event listener (client only; the server emits nothing) |
| `.prop=${v}` | DOM property, never an attribute |
| `${() => v}` | a **thunk is the reactivity convention** — the server calls it, the client wraps it in an effect |
| `${v}` | a plain value, written once — the compiler emits this for any hole that cannot read |

A value may be a primitive, a nested `html` template, an array, a promise, an async iterable, or
`raw(...)`. Lists take `keyed(key, template)` so a reorder moves DOM instead of rebuilding it.

A thunk handing back a **source** — `state`, `memo` or `channel` — is read one step further, so
`${() => search({ q })}` needs no trailing `()`. Sources carry a registry-symbol brand
(`$shared/internal/BRANDS.ts`) rather than being recognised by being callable, so neither substrate
imports the reactive graph to spot one. **`source` is the wider word and `cell` the narrower**: every
cell is a source, but a channel is a source that is not a cell — `publish` rather than `set`, and
nothing to await.

A thunk that hands back a **cell** is read one step further, so a handle in a slot means its value —
`${() => search({ q: filter() })}` needs no trailing `()`. Cells are recognised by a registry-symbol
brand, not by being callable, so neither substrate imports the reactive graph to spot one and a
plain function passed to a `.prop` slot is still a plain function.

```ts
import { renderToString, renderDocument, suspend } from 'abide/server'
import { mount, hydrate, keyed } from 'abide/ui'

await renderToString(App())                    // string
renderDocument('<title>x</title>', () => App()) // streaming document, out-of-order patches
mount(document.body, () => App())              // live DOM, returns { dispose }

// …or take over what the server already wrote:
await renderToString(App(), { hydratable: true })
hydrate(document.querySelector('#app'), () => App())
```

### Hydration

`hydrate` is `mount` with a different way of getting its nodes: every part claims the range the
server marked out for it and then runs the ordinary first update, which writes **nothing** — because
every binding already compares before it writes. Adopting a page costs one inserted node, the root
anchor comment, and the elements on screen stay the objects the parser made.

The two lanes agree through one file, `$shared/internal/MARKERS.ts`, rather than through a contract
kept true by hand in two:

| | Emitted | Why |
| --- | --- | --- |
| child slot | `<!--[-->` value `<!--$i-->` | its content is a **value**, absent from the template — and without the pair the parser hands back `<p>a${x}b</p>` as one text node. The close marker *is* the anchor `prepare` already puts in the client's template |
| attribute · event · property · ref · spread | nothing | the prepared template and the live document agree on the element **positionally**, so the adopt walk finds it by shape |
| list rows | nothing | a row is a template, and adopting a template consumes exactly the nodes it describes — so each row delimits itself |

The markers nest and the scan counts depth, which is what stops `${a}${b}` handing `a`'s close to
`b` when `a` holds a template of its own. `{ hydratable: true }` is opt-in: a render nobody will
hydrate should not read differently or pay for the comments.

Hydration must wait for the whole document — `renderDocument` streams its out-of-order patches
before `</body>`, so `DOMContentLoaded` is the earliest safe moment.

**A divergence costs that subtree, not the page.** The walk verifies as it goes, tag by tag and
marker by marker; a slot whose range is not what this template writes warns and builds itself
instead. A stale cache or a non-deterministic render degrades to a rebuild rather than a blank screen.

`bun run example` renders the example component through both substrates.

## The CLI

```
$ abide
abide

usage: abide <command> [args…]

  repl                An abide prompt: the isomorphic surface in scope, and `.abide` files importable.
  run <file> [args…]  Run a script under the abide runtime. Everything after <file> belongs to the script.
  check [dir…]        Type-check `.abide` script bodies, reporting on the `.abide` line.
  logs                Tail a running app's log feed. ABIDE_APP_URL names it; ABIDE_APP_TOKEN is its bearer.
  -h, --help          This.
```

That screen is **generated from the command table**, and the dispatch reads the same rows — so a
command that exists is one the help names, and there is no second list to fall out of step with it.
What is not in the table does not exist: `abide dev` answers `2` like any other unknown word rather
than being a stub apologising for itself on a help screen. The rest of the spec's table — `scaffold`,
`dev`, `build`, `start`, `compile`, `bundle`, `lsp` — needs a bundler or a boot, and is what is left.

Three things it is careful about:

- **Asking for help is a success**, on stdout, exit `0`. An unknown subcommand is a *usage* failure
  on stderr, exit `2` — not `1`, because nothing ran, and not `0`, because a mistyped command
  exiting `0` tells CI the build succeeded.
- **Exit codes past `2` are HTTP outcomes** (`CLI_EXIT_CODES`): `5` is a 404, `4` is 401/403, `1` is
  nothing answering at all. A script wrapping `abide logs` can tell "the feed is closed" from "the
  app is not there" without grepping stderr for it.
- **A command's body is loaded only when its name arrives.** `--help` is the most common thing a
  binary is asked for, and it should not pay to load a compiler it is not going to run. What the
  binary loads before it knows the command is ~1.3ms — the table, the codes and four ANSI strings.
  It was 7.0ms while one `const` in the shared env read held `process.stdout`, which bun BUILDS on
  first touch; the question is now asked per call, so a command that never colours anything never
  pays it.

`abide run` **spawns** rather than importing: everything after the file belongs to the script,
including a flag this binary answers to itself, and the script keeps its own `argv` and its own exit
code. What the command adds is the `.abide` loader, so a one-off script imports a component exactly
as the served app does.

### The prompt

```
$ abide repl
abide repl
bun 1.3.14 · state · memo · channel · watch and the rest of `abide` are in scope · ctrl-d to leave
abide> const count = state(1)
abide> count
state 1
abide> count.set(4); count
state 4
abide> const Page = (await import('./app.abide')).default
abide> typeof Page
"function"
```

The **isomorphic** surface is what is in scope — `state`, `memo`, `channel`, `watch`, `html`, `log`,
the router, both transports' client halves. A renderer is one line away (`await import('abide/server')`)
and deliberately not preloaded: a prompt that imported both substrates to open would be paying for
the half of the framework you were not asking about.

Naming a source prints **what it holds**, not `[Function]` — read through `peek`, so printing a memo
cannot be the thing that made it load, and one that has not run says `memo (cold)` rather than
`undefined`, which is a value it could legitimately be holding.

Three things are load-bearing under it:

- **`node:vm`, not `eval`.** A global lexical binding made by `eval` does not survive the call in
  JavaScriptCore, so `const x = 1` would be gone by the next line. `runInThisContext` keeps it *and*
  hands back the completion value, which is what prints a bare expression with nothing parsing
  statements to find one.
- **`Bun.Transpiler` answers both questions a prompt has** — is this TypeScript I can run, and has
  the line *finished*. The second comes out of the error message, so multi-line input is the
  language's own answer rather than a bracket counter that disagrees with it about templates and
  comments. Dead-code elimination is turned **off**: a prompt's input is precisely the code whose only
  purpose is its value, and `({ a: 1 })` is not dead.
- **Top-level `await` is the fallback, not the shape.** A line holding one fails to *compile* —
  nothing has run — so the retry through an async wrapper is reached by the engine's own answer
  instead of by a regex deciding what "top level" means. The common line has no await and runs
  plainly, which is what keeps `const` persistent.

Ghost text completes the word being typed, dimmed, taken with Tab or a right arrow at the end of the
line — and it is **off wherever colour is**, because an undimmed suggestion cannot be told from what
you typed. It is a line editor of our own rather than `node:readline` for one reason: drawing after
the cursor means owning the repaint, and owning the repaint is most of a line editor. It takes its
terminal as *hooks*, which is how the one part of this binary a spawned process cannot exercise — a
keystroke needs a tty — is tested by feeding it a string.

## The example pages

`bun run web` serves a page per primitive at `localhost:3000`, plus the bench. No build step: Bun's
HTML routes bundle the `<script type="module">` on demand, so the pages import `abide` directly and
what the browser runs is the source in this repo. Every card shows its own `run` function verbatim
underneath — `Function.prototype.toString`, so the code on screen *is* the code that ran.

**Every demo is also a test.** A case in `packages/example/demos` has one headless `run` that carries
the assertions and executes in both places — under `bun test` and inside the browser card, where a
passing assertion paints green and a failure paints red. The interactive half (`interact`) is
browser-only on purpose: a claim that needs a click is a claim no test can make. So there is no
separate unit-test suite to drift from the pages, and `bun test` is the pages being checked.

| | |
| --- | --- |
| `/state` `/memo` `/verbs` `/channel` `/watch` | the primitives, one capability per card |
| `/routing` | the router, with a card that drives the **real address bar** — back and forward work |
| `/template` | one `html` template rendered **both ways side by side** — server string next to live DOM |
| `/client` | mount, keyed lists, disposal, with the **DOM calls counted** |
| `/server` | streaming SSR, and a live frame you can watch an out-of-order patch land in |
| `/hydrate` | the client adopting that markup, with the **DOM calls counted** — the number is one |
| `/transport` | `rpc` and `socket`, against a `dispatch` called in-process: **three readers, one request** |
| `/logging` | `log`, with a card that turns a channel on by typing a `DEBUG` spelling into it |
| `/health` | `health()` and `onHealth`, with a card that reports a field — or a failure — and asks again |
| `/identity` | `identity()`, with a card that asks — and watches the two writers refuse, because a client may not decide who it is |
| `/ceilings` | the three caps on what a process remembers, with a card that fills a bounded cache and watches rows drop |
| `/bench` | every capability against a hand-written equivalent, one table row per arm |

The bench runs four kinds of case, because the framework makes four kinds of claim: **time**, as a
ratio against `packages/example/demos/vanilla.ts` (which is the code someone would actually write, in a careless
and a careful version wherever the difference is the point); **work**, as counted DOM calls, since a
correctness test cannot guard "does less work"; **wakes**, as counted effect re-runs, since a
reader that woke when nothing it reads changed still reads the right value; and **budget**, as the
DOM nodes and microtask turns a piece of emitted code costs, since a number that quietly grows by an
order of magnitude is invisible to the other three. Every arm is a row on one column template, so the
kinds can be filtered and the numbers scanned down the page rather than card by card.

Two things it found that the test suite could not, both now pinned:

- `html` with a slot at the **root** of the template (`` html`${rows}` ``, no wrapping element)
  painted blank on the first render and only appeared on a later update. The instance recorded its
  nodes before its first update, so anything a child part inserted stayed orphaned in the fragment.
- A keyed swap costs **one move per row between the two**, not two. The existing test swaps indices
  1 and 3 of a five-row list and asserts ≤ 4 moves, which is both "minimal" and "the whole list" —
  it passes either way. See *Known limits*.

## What it does that hand-written code gets wrong

These are not features; they are the specific things a from-scratch version fails at, each pinned by
a test:

- **A throwing effect does not strand the flush batch.** Without per-node isolation one throw
  abandons every later effect in the batch *permanently*, and the thrower stays DIRTY forever — dead
  for the life of the page. `reactive.ts` catches per node, resets to CLEAN, and rethrows from a
  fresh microtask.
- **`refreshing` is its own signal, not a field of a status record.** A re-load over a retained value
  must wake a spinner without waking the readers of the value, and a refresh landing the *same*
  result must wake nobody. A record makes both impossible: it is rebuilt per settle, so the identity
  check never holds and every settle wakes everyone — and `pending()` then wakes on a warm reload it
  still reports `false` for. Both were real bugs here; the fix is one small node per probe, so each
  wakes only on its own transition.
- **A keyed slot IS a cell, not a second implementation of one.** While `memo`'s slots had their own
  status record they drifted from the cell twice — what a retained `undefined` counts as, and whether
  a retry after an error keeps throwing. Same situation, two answers, nothing to catch it. Both forms
  now sit on the same `Async` tracker, and two tests pin the agreement. The keyed call returns that
  cell, which is why there is no `live`/`peek(args)`/`publish(args, v)` vocabulary: nine methods
  were one cell's surface with an `args` parameter bolted onto each.
- **Every binding compares before it writes.** A binding that assigns the value already present
  produces identical output at full DOM cost. Asserted by call count, not by output.
- **Adoption is the same code path as a build, not a second renderer.** A hydration pass written as
  its own walk is a second implementation of every binding, and the two drift the moment one of them
  learns something. Here a part is handed live nodes instead of a fresh clone and then runs the
  ordinary first update — which writes nothing precisely *because* every binding compares first. The
  proof is that it costs one inserted node; a second renderer that merely produced the right screen
  would look identical.
- **A hole that cannot read gets no thunk.** A thunk costs a closure per instance *and* an effect
  node per slot, and being fresh every time it also defeats the identity cutoff that skips an
  unchanged row — so a one-row edit of a thousand-row list re-ran all thousand. The compiler drops it
  when the emitted form is a call-free path (`{item.id}`, a branch-local `const`, a `{#if}`'s hoisted
  local, a cell named alone in a child slot). Call-free is the load-bearing half: `{helper()}` may
  read a cell and nothing about the expression says so. The test is on what the emit *produced*, not
  on what was written, which is why one rule answers both `{count}` in a slot and `{count}` in an
  attribute — the first comes back as `count`, the second as `count()`.
- **An event slot attaches one listener and swaps the handler behind it.** A row's `@click` closes
  over its item, so it is a fresh function on every reconcile; comparing identities meant a detach
  and an attach per row per update, for a listener whose identity nothing outside can observe.
- **A patch replaces the previous run's effects instead of stacking another one.** Every thunk slot
  creates an effect, so patching an instance without first tearing down the last run's leaves one
  live effect *per patch* — each closing over superseded values, all writing to the same binder. The
  output stays correct, because the newest effect runs last and wins; only a wake count can see it,
  and it grows without bound.
- **A same-route navigation wakes only what moved.** `route()` is four cells behind a facade rather
  than a `{ name, params, url }` record, because a record is rebuilt per navigation and therefore
  wakes every reader of it every time — including the outlet, which then tears the page down and
  rebuilds it to show the same page. Both routers render the right screen; only a wake count can tell
  them apart, and the bench runs the record as its vanilla arm.
- **`watch` inside a `scope` registers automatically.** There is no second opt-in spelling: an
  ownership rule that only applies when you remember the other function is not a rule, and the
  failure mode is an invisible leak.
- **A diamond wakes its sink once.** Push-CHECK / pull-recompute, no topological sort.
- **A stale load never lands on top of a newer one.** Two writes in flight, the first settling last:
  without a generation stamp the cell ends up showing the answer to the older question. Asserted by
  resolving the two deferreds in reverse, in `state` and in an argless async `memo`.
- **An expired ttl starts one re-run, not one per read.** The freshness stamp is written when the
  body *settles*, so every read between expiry and the answer landing still sees a stale timestamp —
  and a ttl check that doesn't also ask "is one already in flight?" starts a run for each of them.
  Asserted by counting body starts across three reads in that window, not by the value they return.
- **A sync body is never observable as a load.** Wrapping it in `Promise.resolve().then(...)` costs
  a tick and makes a slot flash `pending` for data already in hand.
- **A failure wakes the readers of the VALUE.** The read throws when a load failed, so an error
  appearing (or clearing) changes the outcome of a read whose value never moved — and subscribing
  those readers to the error channel does *not* fix it: a reader that ran before the cell ever met a
  promise subscribed when there was no error channel to subscribe to, and would sit on the last good
  value as though the load had succeeded. Asserted by flipping error→same-value and counting.

## Known limits

- **`{#try}` is synchronous**, like the `try` it is named after: a rejected promise inside one is not
  its to catch. Its body is also the ONE place the compiler does not give each expression its own
  thunk — a boundary is one unit, so a dependency inside it re-runs the whole body. That is what
  makes it able to catch at all; an expression evaluated in a nested effect throws into that effect's
  isolation, past the boundary.
- **`{:then v}` is typed `T | undefined`** for a `state(promise)`, because `Cell<T>` uses one type
  parameter for both what a READ returns and what an `await` resolves to. The read really can be
  `undefined` before the load lands; the settle cannot. Splitting them is a public-API change.
- **A route's modules are reached through a loader, and nothing generates that list for a browser.**
  `pages(dir)` reads that directory off the filesystem, which is a server. A client is handed the
  same table by whatever built its bundle — and there is no CLI yet, so today that means writing it
  down. The table's SHAPE is the same either way, which is the part that had to be settled.
- **`identity()` seals a cookie and nothing else.** There is no token, no revocation list and no
  refresh pair: rotating `ABIDE_IDENTITY_SECRET` signs everybody out, which is the whole of what
  revocation means here. The seal is an HMAC, so a browser can READ its own claims — that is a
  session cookie's actual contract, not a gap — but an app putting something in there that a user
  may not see wants a row id and a resolver, which is what `onIdentity` is for.
- **A websocket upgrade carries no `traceparent`.** A browser cannot set headers on one, so a socket
  subscription is correlated by nothing. The rpc lane is unaffected — that is a `fetch`.
- **The example dev server runs with `development: { hmr: false }`**, and it is a workaround rather
  than a preference.
  Bun's dev server wraps every module in a registry function so it can swap them, and that wrapping
  evaluates a circular ESM graph in an order plain ESM never would. TypeScript's `unstable/ast`
  barrel is one (`export * from "./visitor.js"`), so with HMR on, every page reaching the compiler
  died at import with `TypeError: null is not an object (evaluating
  'import_visitor3.visitEachChildOfJSDocParameterTag')`. A `Bun.build` of the same entry is fine — it
  inlines modules in dependency order — and the enums are only reachable through that barrel, so
  there is nothing to import around. Reproducible in three lines with no abide in them.
  `{ hmr: false }` rather than plain `false`: `false` is a PRODUCTION build and minifies, so every
  card's `Function.prototype.toString` reads back as one mangled line and the source a card shows is
  not the source anybody wrote. The object form re-bundles the route per document request — 3.4ms a
  navigation against 0.3ms cached — which buys back the one thing the cards exist to do.
- **`web.test.ts` cannot catch a browser-lane failure.** It builds each page through Bun's own
  *loader*, where `Bun` exists and there is no bundler ordering modules — so the one thing it was
  written to catch, a page that throws on load and still returns 200, is the one it cannot see. Both
  failures above were found by loading the pages in Safari, not by `bun test`.
- **`/compiler` (484 kB) and `/bench` (693 kB) bundle TypeScript**, because one runs the compiler
  and the other runs every suite's bench. Every other page is 39–93 kB and carries none of it: a
  page imports its own suite module by name, and the nav and hub read `demos/SUITES.ts`, which is
  metadata only. Routing pages through one list of suites instead put ~700 kB of compiler on
  `/state`.
- **Hydration leaves its opening markers in place.** One inert comment per child slot survives the
  adoption, and is removed only if that part later rebuilds. Sweeping them costs a `remove` per slot,
  which is the number this whole feature is about.
- **`{#await}` and `{#for await}` rebuild when they land.** The server awaited its operand and
  painted the settled arm; this side starts with a promise in flight and cannot know *which* arm
  those nodes are until it settles, so the range is held as-is and replaced. Better than flashing
  back to `pending`, and still a rebuild. `{#for await}` is worse: the client re-streams from the
  top, so the server's rows go immediately.
- **A `.prop` slot writes on adopt**, because nothing was serialised for it to compare against —
  `.value=${x}` sets the property once during hydration. Not counted as DOM work, but it is work.
- **Attribute slots must be unquoted** in a HAND-WRITTEN template (`class=${x}`, not `class="${x}"`),
  and a slot cannot be part of a value (`class="a ${b}"`); the classifier raises a `SyntaxError`
  naming the offending text. A `.abide` file has no such limit — the compiler owns the whole
  attribute, so `href="/x/{id}/y"` folds into one expression.
- **`.prop` slots emit nothing on the server** — a DOM property has no serialisation. Use an
  attribute slot when the value must survive SSR.
- `{#await}` **evaluates its operand in a different effect from its branches**, which is what makes
  an inline promise safe. The slot's thunk reads only the operand and hands over four unevaluated
  closures; the part paints them later without waking it. Choosing a branch in the thunk — by reading
  `pending()` — would make settling wake the thunk, re-evaluate the operand into a fresh promise, and
  loop forever with real requests behind it. Pinned by counting operand evaluations, since the output
  looks right either way.
- **A pending cell renders blank on the server**, because a server render is a snapshot with nothing
  to wake later. `suspend(cell, (v) => …)` — cells are thenable — is how a load reaches SSR.
- **A type error inside a `<script>` is reported on the GENERATED line**, not the `.abide` one. A
  template expression is emitted behind a marker and lifted into the source map; a `<script>` body has
  its imports hoisted and merged, so it no longer lines up with the file. `remap` marks those
  `[generated]` rather than moving them somewhere it cannot justify, and `test/types.test.ts` asserts
  which diagnostics land where — so the gap cannot widen quietly, and the day it is closed that table
  says which rows to promote.
- **A transport's OPTIONS do not cross the wire**, and cannot: `GET(fn, { middleware: [auth] })` is
  server-side text, and an option may reference a server-only import, so there is nothing a stub
  could copy. What crosses is the consequence — a `ttl` arrives as an `abide-ttl` response header and
  the client's slot goes cold on the server's schedule. Tags do not cross, so `invalidate({ tags })`
  reaches one side at a time. A declared shape is the same rule seen from the other end: `schemas`
  never leaves the server, and what a caller sees is a 422 for an input that does not match. Only
  `opts.clients` is spec'd and unbuilt.
- **JSON Schema is what a declaration MEANS**, not something abide converts to on the way out. That
  order is forced: Standard Schema is validate-only, so a shape declared through zod or valibot
  cannot become a tool definition or an OpenAPI operation — a shape abide can only run is a shape
  abide cannot publish. A plain function and a Standard Schema are alternative VALIDATORS over the
  same call; the published shape comes from the JSON Schema, or from the type.
- **The shape is derived from the type when nobody declares one**, syntactically, in the same
  compiler pass that writes the browser stub. A derived shape may know less than the type does,
  because under-constraining refuses nothing the handler would have accepted — but it may not be
  wrong about which members EXIST: a published shape missing a required argument is one a machine
  reading it builds a broken call from.
- **An imported type is a filesystem question, not a type-checker one.** `elide` takes a `resolve`
  that hands over another module's text rather than reading one itself, so the compiler stays a pure
  function and a demo can still run it in a browser card. The Bun plugin supplies the real one,
  lazily and cached; the browser lane never gets it, because the stub carries no shapes.
- **A computed type needs the checker, so there is a second speed.** `Omit`, `Pick`, conditional and
  mapped types, `enum`, a generic alias — no amount of text resolves those. `bun run shapes` runs the
  real checker over the project and writes `.abide/shapes.json`, which the plugin reads. It only ever
  UPGRADES: an endpoint it says nothing about keeps what the tokens said, so a stale file publishes
  less rather than something wrong. It runs under NODE, because TS 7's checker is the native `tsgo`
  binary behind a sync RPC channel reading a Node-internal fd that Bun does not expose.
- **A `File` in the args is an argument**, not an upload endpoint: the client sends multipart because
  the args held something JSON cannot carry, the JSON keeps a reference where the file sat, and the
  handler gets the same one args object. A read takes that door too — what has no text form cannot
  travel in a URL. Files are keyed by IDENTITY in the memo slot, because two files with the same name
  and length are not the same file and reading them to find out is not something a cache key may do.
- **A handler streams iff it is written `function*`.** The browser lane builds its stub from a file
  it never loads, so the syntax is the whole answer; a generator assembled elsewhere and passed in is
  not seen as one. Same rule `.abide` lives by, same reason.
- Lists are keyed but placement is a simple in-order walk, not a minimal-move (LIS) reconcile.
  Nothing is ever re-created — every row survives as the same element — but a swap costs **one move
  per row between the two**: rows 1 and 198 of 200 is 197 moves where a minimal reconcile is 2.
  Adjacent rows cost 1. The existing test swaps indices 1 and 3 of a five-row list and asserts ≤ 4
  moves, which cannot tell the two apart; the client suite now asserts the exact move count at three
  distances, and benches it at two.

## Roadmap

1. **The rest of the CLI.** The binary exists — the table, the exit codes, `repl`, `run`, `check` and
   `logs` — and what is left is every command that needs a bundler or a boot: `build` and `start`,
   `dev` with its watch and live-reload, `scaffold`, `compile`, `bundle`, `lsp`. `build` is the one
   that turns `pages()` into a table a browser bundle also has.
2. **The app-level exports** a booting command would read — `middleware`, `onStart`, `onStop`,
   `onError`. `onError` and `middleware` have a seam already: `dispatch` opens one request scope
   every lane is served in. `onStart` is the one that genuinely needs the boot, because it WRAPS the
   socket bind — which is why it is still absent while `onHealth` and `onIdentity` are calls.

## Provenance

Grown out of a four-domain vanilla-vs-abide review (`abideclean/packages/bench/roundtable`), where
hand-written implementations of SSR, hydration, the reactive graph and the primitives were written
and measured against abide's. The findings that shaped this codebase: the reactive core and the
primitives are *at or faster than* hand-written, so the machinery earns its keep there; the costs
are unconditional bytes and per-row emitted work; and the things vanilla gets wrong are failure
behaviour, not throughput. The "what it does that hand-written code gets wrong" list above is that
review's evidence, applied.

Vocabulary is abide's: `state`/`memo`/`channel`/`watch`. `signal` is deliberately not a name here —
abide retired it to avoid colliding with the TC39 Signals proposal, and a cell is callable rather
than an object with `.value`.
