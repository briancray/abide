# @abide/abide

## 0.123.3

### Patch Changes

- abfff21: Router's doc names the LevelChain that stops a page's scope ([`00c3d2d`](https://github.com/briancray/abide/commit/00c3d2d8038c673e5a067b01402b0d270fa485b8))
- abfff21: a spread writes through setAttribute's compare-then-write (writeAttribute) ([`017a6ff`](https://github.com/briancray/abide/commit/017a6ff26a1e9ba460973b63b2c8ffc5f9e2f863))
- abfff21: the routed mount argument comment names LevelChain.mountFrom ([`0942e6e`](https://github.com/briancray/abide/commit/0942e6e9d6545dd24d41579fd5ec28e9478892d9))
- abfff21: a patch-log release run twice leaves a log a later follower opened ([`206d8df`](https://github.com/briancray/abide/commit/206d8dfde626592eb5ca885567f30afeed6b0b6e))
- abfff21: one patch log for followed values, and patch marks behind functions ([`3cdda11`](https://github.com/briancray/abide/commit/3cdda118d9a8ed4cbd32834c8cd7823c26f0b5fb))
- abfff21: one args contract for every way a handler is called ([`4e2dcab`](https://github.com/briancray/abide/commit/4e2dcab0bddaf555404fc22687e2efd41d28b500))
- abfff21: the {#try} ambient is Scope's private, set only through underBoundary; TryRegion swaps through ArmRegion's fills/armOf ([`54e6a91`](https://github.com/briancray/abide/commit/54e6a9158bd9fe167578479a3ce4669d13797457))
- abfff21: a file the layout has not seen is checked as painting only where it paints ([`587597f`](https://github.com/briancray/abide/commit/587597f23cdeb331816049ff0670b99eebcb1cd8))
- abfff21: one diagnostics sink owns the finding type, its placement, abide-ignore, order and printing for build, dev, check, format and the language server ([`6d11f57`](https://github.com/briancray/abide/commit/6d11f57adc226b45bd0ddf1b4a305ee6d7a7a000))
- abfff21: socketWire and outboxQueue each reset in one call (resetSocketWire, resetOutbox); tests stop reaching into Mux internals and draining the outbox by timing ([`721774f`](https://github.com/briancray/abide/commit/721774f93df6040e20015f03755879c4cf534a38))
- abfff21: a mounted handler is held to the schema its row derived, so a bundled executable coerces and validates its args (RULEBOOK 19.9) ([`76c92a5`](https://github.com/briancray/abide/commit/76c92a51f0b3f49ee95e95d8088c320d7a896341))
- abfff21: an editor shows the findings abide check has for a file — lints, handler warnings and the emit's refusals included (RULEBOOK 38.11) ([`9824535`](https://github.com/briancray/abide/commit/9824535e191b0f9748edaafadc0bc8ecc08f75d0))
- abfff21: simplify pass — one placedSource, packageDirectory in appTree, derivedArgs probes once, manifest read beside the table, PatchLog followers always a set, pairingStatus yields the code alone, KeptChecker's heard takes nothing ([`9a6e663`](https://github.com/briancray/abide/commit/9a6e66361364b841cb53362ace080eb1e7d0372f))
- abfff21: ServerRoute and ServerError stay private to answerRequest ([`9c51de6`](https://github.com/briancray/abide/commit/9c51de674db98e4c2793fa8f496ebe54924c087f))
- abfff21: the build on disk is one module, and booting from a compilation is one ordering ([`a3a5349`](https://github.com/briancray/abide/commit/a3a5349baa9c55c9a931f00d635a57743ddf1cdc))
  
  An app with no `src/` — its root is its package — now keeps its default `.abide` build and its `bun test` build cache inside the package rather than in the directory above it, as RULEBOOK 38.27 has a build sit beside its app; an app with a `src/` is unchanged.
- abfff21: a LevelChain owns the routed levels and their head bracketing; Router takes a popped history step through one entry and keeps its step bookkeeping private ([`a4d9641`](https://github.com/briancray/abide/commit/a4d9641105f9d1f9958b9bb6fcf90323c07cd6a8))
- abfff21: a kept checker reopens a stale project, drops one that threw and owns its watchers, for dev and the language server alike ([`c733d7e`](https://github.com/briancray/abide/commit/c733d7ea7b648a02ed366ffe172aa3b996c7e0de))
- abfff21: a handler file's mount row is built once, for the compiler and the in-memory test app ([`c7db045`](https://github.com/briancray/abide/commit/c7db0459e89ba4ea74918f29d7823c87a9e01d47))
- abfff21: format the try and wire changes ([`c85913a`](https://github.com/briancray/abide/commit/c85913a0a36bc8e828885b795ba31340057a22ff))
- abfff21: the bridge relay writes its own frames and hears sign-ins rather than being told ([`ed69e87`](https://github.com/briancray/abide/commit/ed69e87be6e92f9980cb4f9b66edc59f56f7a88f))

## 0.123.2

### Patch Changes

- 4ce217a: `validateJson` reads a member left `undefined` as absent, so an `args: jsonSchema(...)` gate accepts `note: undefined` where `note` is optional rather than refusing it 422, as the derived args schema already did (RULEBOOK 19.25).

## 0.123.1

### Patch Changes

- the args-as-sent walk returns the args it does not copy, walks a cycle once, and keeps a parsed __proto__ a member (RULEBOOK 19.25) ([`ee02cac`](https://github.com/briancray/abide/commit/ee02cacbb64f00374ae98154e788c59c5a4ec49b))
- bf77c28: `abide check` no longer fails when an inline component is passed to a component that sits inside another component's body: the outer close tag's read in the check's projection now ends with a `;`, so the braces that scope the passed component are not parsed as an arrow function.
- 7c24094: A no-argument mutation behind `middleware` no longer starts its body before its rungs run. Dropping the previous call's answer built the request's instance of the handler, which started the body ahead of every rung, so a refusing rung (`signedIn`) answered after the body had already run. Calling the same mutation twice in one request now writes twice behind rungs as well (RULEBOOK 16.7, 16.11, 16.16).
- 94fbea7: A handler's derived args schema reads a member left `undefined` as absent, so an in-process call like `getResearch({ home, topic: undefined })` is answered as the wire answers it rather than refused 422 (RULEBOOK 19.25, 15.8).

## 0.123.0

### Minor Changes

- 0e5f83e: an unfinished conversation's log line says why — aborted, failed with the throw, or stopped (RULEBOOK 44.31) ([`042aea3`](https://github.com/briancray/abide/commit/042aea3150ae0fd29959bbe1346d1595b86617bc))
- 0e5f83e: Breaking: a member the value's type declares is the value's, and a read prop holds a Reactive where one is due (RULEBOOK 31.5, 31.6, 33.27) ([`50b1151`](https://github.com/briancray/abide/commit/50b1151d46389185df0b61d0dd82241566446275))

## 0.122.0

### Minor Changes

- a2144de: `Middleware` is one type for a rung shared between handlers and layouts: `const signedIn: Middleware = async (next) => …` fits a handler's `middleware: […]` and a layout's `middleware(…)` alike, with no `<Ctx, Result>` of its own. `Middleware<Response>` is a rung that answers with a `Response` of its own, and `Middleware<never, { args: () => unknown }>` one that reads a handler's args. A `refuse(…)` a layout's rung returns is now answered in its lane — the nearest error page over a page, Problem Details over a handler, and by what the request accepts before routing — and the rung outside it is handed that `Response` (RULEBOOK 37.14, 37.15). BREAKING: `Middleware<Ctx, Result>` written with a context type first no longer reads that way; annotate `next` instead, or use the forms above.

### Patch Changes

- 44e9f1d: ABIDE.md names the one-word Middleware form for a shared rung (RULEBOOK 37.14) ([`0699004`](https://github.com/briancray/abide/commit/0699004266bf8174263d1820cee2e9946eeee8a3))

## 0.121.1

### Patch Changes

- 7d6571d: a pairing link written into an href survives the URL scheme check — abide-bridge: joins the safe set, and the render warning names the set it checked against (RULEBOOK 32.20, 44.40) ([`aaba479`](https://github.com/briancray/abide/commit/aaba479a86b318d2441e920b6f7cfd124cb6c75e))

## 0.121.0

### Minor Changes

- 980d729: the agent instructions ship in the package and a scaffolded CLAUDE.md imports them, and the starter comes with tailwind wired (RULEBOOK 38.104, 38.106, 38.131) ([`c95852e`](https://github.com/briancray/abide/commit/c95852e7bc195cb9f5ef53f0623e31700362b302))

### Patch Changes

- 980d729: the shipped agent instructions are ABIDE.md, so no agent working on abide reads them as its own, and a gate holds their citations and the starter's tailwind to what resolves (RULEBOOK 38.104, 38.106, 38.131) ([`2880551`](https://github.com/briancray/abide/commit/2880551b777247a88e7042fa5bdd462fab3e40b2))
- 980d729: one dangling-citation scan and one built-stylesheet read in the tests, and the shipped agent instructions state each rule once ([`602cb8f`](https://github.com/briancray/abide/commit/602cb8fd87f136ea23a58dd006bdac43ca65ebe4))

## 0.120.0

### Minor Changes

- 2af648d: a pairing link beside the command — abide-bridge install registers a macOS app that opens it and asks before it pairs (RULEBOOK 44.40-44.43) ([`409d5ac`](https://github.com/briancray/abide/commit/409d5ac7f95338cb3f44a21cc76cd977387eab42))

## 0.119.0

### Minor Changes

- a9f8ad1: abide format formats every .abide — its scripts, styles and expressions by bun fmt, its markup by its nesting — and leaves one as written where the template would change (RULEBOOK 38.125-38.130) ([`fb0b837`](https://github.com/briancray/abide/commit/fb0b837b1264a4193371388a61fb64ec81f16638))

### Patch Changes

- a9f8ad1: bun fmt replaces biome, and an unused local or parameter is a type error ([`259f9b1`](https://github.com/briancray/abide/commit/259f9b18b9c2bd12b6ab5c9d9784adb2b8d2edd1))
- a9f8ad1: format the repo with abide format and bun fmt ([`d7cd46d`](https://github.com/briancray/abide/commit/d7cd46da1e0cd523631d38d923f8bb08d1f0716f))

## 0.118.0

### Minor Changes

- 1613343: Breaking: a handler file is named <name>.handler.ts (RULEBOOK 23.14, 23.22) ([`5f64c1b`](https://github.com/briancray/abide/commit/5f64c1b02dec18c6e8574a88ee46e2f7477bee71))
- 1613343: Breaking: a route param names a matcher in a <NAME>.param.ts, and one naming none takes no part carrying a period (RULEBOOK 23.24-23.27, 30.34-30.37, 20.23) ([`db7b00d`](https://github.com/briancray/abide/commit/db7b00d07bbb8f47bc73a757356675555b276b51))

### Patch Changes

- 1613343: a page answers 404 to a request that cannot display it, before its setup runs (RULEBOOK 35.19) ([`7276d7c`](https://github.com/briancray/abide/commit/7276d7c41a44b5602b9dd4a779f85b3a05aa260f))

## 0.117.2

### Patch Changes

- ea4e27f: a value opening at a member of a name read by name — `reactive(route.url.searchParams.get('book') ?? '')`, `reactive(name.toUpperCase())` — is now a `Reactive` the file reads and writes by name, where before `abide check` refused every write as a string assigned to the `Reactive` and the build rebound the name instead of calling `set`
- ea4e27f: a value a `refresh({ tags })` marked while nothing read it loads when the next page adopts it — `reactive(() => getMeetings())` on a page visited after the write sends the request and serves the new answer, where it served the answer held before the write and asked nothing (RULEBOOK 13.7)

## 0.117.1

### Patch Changes

- 05ba855: a ceiling naming no bench fails the run, and a bench file sits beside any code it times (RULEBOOK 23.22, 43.32-43.34) ([`d5f3d3c`](https://github.com/briancray/abide/commit/d5f3d3cc6368057f8437559aafc7113abd2b3269))
- 05ba855: a refusal and the starter's notes say a lib/ or public/ fence may sit in any directory above the file (RULEBOOK 23.22, 23.23, 37.1) ([`d9d95df`](https://github.com/briancray/abide/commit/d9d95df07fb8cb92a295ffc9a316da9b5bc6141e))
- 9e24653: `runBenches` (`@abide/harness/runner`) and the `harness-bench` command run every `*.bench.ts` under an app's `src`, print each arm's time and the claim between them, and fail the run where an arm goes over its `CEILINGS` entry or a ceiling names no arm (RULEBOOK 43.29-43.33); `abide scaffold` writes a `bench` script that runs it, and the starter's agent notes say to measure with the harness (RULEBOOK 38.124)

## 0.117.0

### Minor Changes

- 3bb5cc9: `abide dev`, `build`, `start`, `check`, `routes`, `compile`, `bundle`, `openapi`, `mcp` and the shell now refuse to run on a bun outside abide's `engines.bun`, naming the bun running and the range it needs (RULEBOOK 38.123)

### Patch Changes

- 3bb5cc9: a component whose markup reads a bare `busy()` or `ready()` is now built on the server after the turn, once the siblings after it have started their loads, so it paints the arm the browser chooses at hydration rather than one that is rebuilt (RULEBOOK 41.28, 41.31)
- 3bb5cc9: the rulebook now states that the effects one turn wakes, a slot's own update among them, run in no guaranteed order (12.15) — a `watch` that post-processes what a sibling `{raw(...)}` slot renders cannot count on the slot having updated first
- 3bb5cc9: markdown imported `with { type: 'text' }` into an app's `.ts` now checks as a `string` under `abide check`, as it already did in a `.abide` — no more hand-written `declare module '*.md'`
- 3bb5cc9: the `bunfig.toml` `abide scaffold` writes now sets `[install] peer = false`, so a dependency's peer on `bun` (`bun-plugin-tailwind`'s) cannot install an older bun that shadows the system one inside `bun run` (RULEBOOK 38.122)
- 3bb5cc9: the rulebook states three things that held but were never written down: a `raw` slot writes its markup unchecked (32.77), a fragment-only step moves `route.url` (30.33), and a `refresh` over `tags` reruns no synchronous derivation that carries none of them (13.20) — and the registry says `route.params` is `Params` outside a page or layout

## 0.116.4

### Patch Changes

- f4acbfd: a handler whose args schema is derived from its type annotation (no `args` gate) now refuses bad args in process as it does over the wire — a direct call, a call from another handler or `app.run`, and every call under `mount` answer 422 `ValidationError` with the same `Issues` before the body runs, where before the body ran with the bad value
- be88738: a reader that probed a handler before its first call wakes when the call starts — on a server and under `mount`, `disabled={save.busy()}` read before any call stayed enabled for the whole write, because the unreached answer (0.116.3) subscribed the reader to nothing. It now subscribes the reader to the first call in its scope, and still builds nothing and runs no handler (RULEBOOK 3.3, 13.19)

## 0.116.3

### Patch Changes

- 9007822: A `bind:` writes its value before an `on<event>` on the same element runs — `<input type="file" bind:files={picked} onchange={use}>` hands `use` the files just picked, and an `oninput` beside `bind:value` reads the text just typed, wherever the two are written in the tag (RULEBOOK 32.75).
- ecf1ff0: a `bind:` through a computed key writes back — `bind:value={params[key]}` and `bind:value={params[s.k]}` inside a `{#for}` write the entry the key names when the input fires, and follow the key when it changes, where they were handed the read and never wrote; a `bind:` through an optional step (`params?.a`) is now a build error (RULEBOOK 32.75) rather than a read that writes nothing
- ee8cce7: a handler with no `args` gate whose parameter is one record now carries the `ValidationError` the wire refuses its args with — `rpc.isError(e, 'ValidationError')` narrows to it and `e.data` is `Issues<Args>`, where it narrowed to `never`. A handler with no args, a scalar, a list, a union of records or `unknown` derives no schema and still carries none
- fe68a88: a handler no call has reached is not busy, and asking runs nothing — on a server, `save.busy()` over a never-called `POST(async () => …)` ran the write and reported it in flight; it now answers as a handler with no entries (`busy` false, `ready` and `synced` true), for a `GET` with no args as well. A probe over a mutation a `refresh()` invalidated no longer sends the write again (RULEBOOK 3.14, 13.19)
- 874c919: under `mount` in `bun test`, a dynamic `import('#src/…')` from a component's browser module resolves as the static one does, rather than failing with "Cannot find package '#src'"
- f60ea39: under `mount` in `bun test`, a component's browser module calling a private handler (one its `<script server>` declares) is answered by that handler in the test's process, rather than fetching an `/abide-client:/…` address and failing with 503 — as a handler file's call already was
- 3e999ce: a throttled value lets its first change through at once — `reactive(x, { throttle })` then `s.set(v)` reads `v` back in the same turn, where the value it was built with had opened a window that held the first `set` back. RULEBOOK 5.12

## 0.116.2

### Patch Changes

- ef77e8d: a comment directly above an at-rule in a component's `<style>` no longer breaks its scoping — `/* … */ @media (…) { .x {…} }` scopes `.x` as it would with no comment
- 99631d1: the registry names `isFailed`, says `route.url` includes the fragment and `route.name` is the same under any mount path, and shows a `GET` over a plain function or a value taking `ReactiveOptions`; a scaffolded app's AGENTS.md names the `abide-ignore` escape, exporting a `Reactive` unwrapped, never `raw()` on untrusted markup, and `config` / `cookies()` over `Bun.env` and header parsing

## 0.116.1

### Patch Changes

- 7dedb9a: the offline worker keeps an answer marked `cache-control: public` — a public file, a font a stylesheet draws with — through a sign-in, a sign-out and a form submitted, which drop only what was saved for the caller
- 6a69393: a copy the offline worker kept stands in for a year where the network fails, rather than a week — a page, a GET's answer and a public file carry `stale-if-error=31536000`

## 0.116.0

### Minor Changes

- c1c3924: `bind:files` — a file input's files as an array, one or many: a pick writes them, and an array written to it (one dropped, or `[]` to clear) is what the input holds. A `bind:` an element has no property for, such as `bind:file` or `bind:vlaue`, is now a build error where it compiled to an attribute that bound nothing. RULEBOOK 32.73, 32.74
- 48cfc3e: tools answer images — a handler whose answer is a png, jpeg, gif or webp body reaches a model as the image: `/__abide/mcp` carries it as an `image` content item (so Claude Code, through a bridge, sees it), and a `Toolbox` call answers a `ToolAnswer` of `content` — the same pieces, text or image — which `claudeApi` shows the model as the call's result. Any other image type, an svg, is answered as its text. Breaking for a hand-written `Provider`: a `ToolAnswer` is `{ content, failed }` where it was `{ text, failed }`. RULEBOOK 20.21, 44.35
- 48cfc3e: multimodal transcripts — an `AssistantMessage`'s `content` is its words or its pieces in order, each `AssistantContent` text or an image as base64 with its type. `assistant` refuses an image a model can't take or one outside a user turn, and hands a `Provider` every turn as its pieces, words alone as one text piece. `claudeApi` shows each image to the model as an image block in its place, and `claudeCode` sends the one message Claude Code is sent as Messages API blocks, each image in its place. RULEBOOK 44.5, 44.36, 44.37, 44.38, 44.39

### Patch Changes

- 0a78343: a page reached inside the app reloads offline — the router tells the offline worker each address a navigation reaches, and the worker keeps its page where no saved copy would stand in ([`a3975be`](https://github.com/briancray/abide/commit/a3975be224584df096fe799c6291c0dfcd80cf84))

## 0.115.0

### Minor Changes

- bdecaf9: offline-first calls — a kept copy stands in for the network, `synced` says whether what is held is what the producer made, a call's `offline` settles it where no answer came, and `outbox` holds the calls a browser queued until they deliver ([`28322d1`](https://github.com/briancray/abide/commit/28322d10f53305c5a3dd17823a9541f877e131eb))

## 0.114.1

### Patch Changes

- ea48b1b: a server stack frame names the .abide column it was thrown at — bun 1.4.4 counts a call site's column from 1 ([`81bcd9b`](https://github.com/briancray/abide/commit/81bcd9b5dab56c14c6b9262361d0dfdb068fb3f5))

## 0.114.0

### Minor Changes

- 595ccb1: a Claude Code pairing belongs to the sign-in that minted its code — another sign-in at the browser is refused 409 and offered its own, and an open bridge status follows a sign-in or sign-out ([`7036ed1`](https://github.com/briancray/abide/commit/7036ed181763c74eaf72ad4550e05c9d63a2d6ab))

## 0.113.0

### Minor Changes

- 3c32bf6: a Store may watch — each change it reports re-reads get without running the body, and the watch stops when the value is released ([`a5539eb`](https://github.com/briancray/abide/commit/a5539eb9d1673a3b4dd98c0e35cc8d8dfb8c5e96))
- 3c32bf6: App.run takes a principal — the claims its scope resolves from through onPrincipal, with no cookie written ([`c0db93c`](https://github.com/briancray/abide/commit/c0db93cb8f41533137a7cb3f833627bebbe9d65f))
- 3c32bf6: under bun test with the test preload, an app that declares no ABIDE_PRINCIPAL_SECRET signs in with one the preload supplies ([`db09b9d`](https://github.com/briancray/abide/commit/db09b9d3aceeffe3d385ae295601ca9158dc2b86))

### Patch Changes

- 3c32bf6: an element the client builds takes the namespace the parser gives it there — a component inside an svg draws — and an xlink:href it writes is XLink's; the harness counts createElementNS and setAttributeNS ([`0dd560a`](https://github.com/briancray/abide/commit/0dd560a35d54a86d8ff5d3bc7762ed6c6968c71f))
- 3c32bf6: a Keyed holds no entry for args its gate refuses, and the gate runs once per entry rather than on every refresh ([`1560749`](https://github.com/briancray/abide/commit/1560749419b1c571130c812fb0f6c3e2bac2a021))
- 3c32bf6: abide check takes a url literal naming one of the framework's own fetched addresses — openapi, mcp, health, principal ([`c8af3dc`](https://github.com/briancray/abide/commit/c8af3dc746766fc5cbe322dbde551b15137c7330))

## 0.112.0

### Minor Changes

- cabe8d1: a class or style attribute beside class: and style: directives keeps moving and writes only its own classes and declarations, and an element where a bind: and something else both write its value is a build error ([`bbbfd81`](https://github.com/briancray/abide/commit/bbbfd810d817235ddb51b8c605756187e473719e))

### Patch Changes

- cabe8d1: one writer owns document.head — a keyless head node stands in its contributors' order, an equal one another contributor made stays when the first leaves, and a page's head leaves with its layout's slot ([`f21f687`](https://github.com/briancray/abide/commit/f21f68742efb463f7873a6aafc4482fd572363e7))

## 0.111.0

### Minor Changes

- f9b3789: ABIDE_OFFLINE — a built app keeps its pages and bundle in a service worker and installs as a web app, a call that reaches no server refuses 503 and a stale value goes on serving, and the socket mux redials when the browser comes back online ([`ee0428a`](https://github.com/briancray/abide/commit/ee0428a958fc70bf13eb10f2d8df2d7b8f3232df))

### Patch Changes

- f9b3789: a request is never reaped by the idle timeout while it is being answered, an idle connection is reaped after 10 seconds, and every event stream beats every 15 seconds ([`14eea6e`](https://github.com/briancray/abide/commit/14eea6e7ae0b72eb194c16e17ca4e7c4498baf46))
- f9b3789: the client bundle is built in the NODE_ENV of its mode, not of the process that started the build ([`c94a975`](https://github.com/briancray/abide/commit/c94a975f38da935b0f62e52789cefe07d5e887ba))
- 0838a38: fix: a `blob:` or `data:` URL passes the URL-attribute scheme check (RULEBOOK 32.20), so `<image href={objectUrl}>` or `<img src={dataUrl}>` shows its image instead of being written empty
- 110aa66: a `ttl` of `Infinity`, or past the 2^31 - 1 ms `setTimeout` holds, no longer re-arms its timer every millisecond for the life of the value: `Infinity` arms none, and a longer `ttl` arms at the cap and re-arms from there

## 0.110.4

### Patch Changes

- 2838836: an MCP tool call under a mount is asked under the mount, so a route whose first segment is the mount's name no longer 404s ([`0ceed49`](https://github.com/briancray/abide/commit/0ceed4966d55cd1b56902dc88c7961725319418f))

## 0.110.3

### Patch Changes

- 804b901: the root below a mount is the bare mount, url('/') writing /docs and /docs/ redirected to it ([`9c5d3c3`](https://github.com/briancray/abide/commit/9c5d3c360c27f2d9918fb663d7aff83b22078707))

## 0.110.2

### Patch Changes

- 14ee265: an SVG element spelled in camelCase hydrates, the compiler asking for the tag the parser writes inside an <svg> ([`f10c81b`](https://github.com/briancray/abide/commit/f10c81bff3ce0e43762a71e24634a218312c0d93))

## 0.110.1

### Patch Changes

- 2aac4eb: an MCP tool's inputSchema is an object at its top level, and args that can never be one refuse the app at boot ([`ec9d80b`](https://github.com/briancray/abide/commit/ec9d80bb6f8902ba1d9f016f6dcd85eba83a47ef))

## 0.110.0

### Minor Changes

- bfa7a68: Breaking: a server-only module and a test are named by file rather than by directory — `<name>.server.<ext>` under `lib`, `.test.ts` anywhere; `lib` and `public` are the only fences ([`e8e2666`](https://github.com/briancray/abide/commit/e8e266676a90d4f4534b74c6373116a1cbab277b))

## 0.109.0

### Minor Changes

- f969612: claudeCode.bridgeCommand and claudeCode.bridge take tools, and the command they mint grants them after its -- ([`d20a962`](https://github.com/briancray/abide/commit/d20a962523f91161cb731e766863256fd5d90208))

## 0.108.0

### Minor Changes

- fda92c3: every MCP tool call writes a debug line on abide:mcp, and every assistant conversation one on abide:assistant ([`6c4d8c7`](https://github.com/briancray/abide/commit/6c4d8c745491308c0208eb18e900473fb8ee9e03))

### Patch Changes

- fda92c3: a back or forward that reloads no longer writes the departed page's scroll into the entry being loaded ([`294c0e6`](https://github.com/briancray/abide/commit/294c0e6ed806c38e80a1f872e7be6ac5579c7382))
- fda92c3: a site holds a dropped bridge pairing for 60 seconds, past when the bridge notices a silent drop ([`ac8e1d3`](https://github.com/briancray/abide/commit/ac8e1d313b7ea54414cd1034b56eb4cfa88ab31b))
- fda92c3: bind:value on a <select> selects an option added after the value was written ([`cd592b2`](https://github.com/briancray/abide/commit/cd592b2ccdc617c5cfed2a6acf5f5a458bc9986b))
- fda92c3: markup the client parses for a raw value, an {#if} arm or a {#for} row inside an <svg> or <math> is parsed in that namespace ([`f8ba81e`](https://github.com/briancray/abide/commit/f8ba81e94e0583858811e3c403535c0c0632b87c))

## 0.107.0

### Minor Changes

- bd2a74f: Breaking: an assistant announces a tool call as the model starts writing it, and a site may ask the visitor's Claude Code for built-in tools ([`c959804`](https://github.com/briancray/abide/commit/c959804fd19c3e99fe439f3f1120f1ef13f42ff8))

### Patch Changes

- bd2a74f: a bind:element callback is handed a connected node whose blocks and components have built, and bind:element on a component is a build error ([`e15fbee`](https://github.com/briancray/abide/commit/e15fbee6f7c780dab2105ca245dd79dbb4a2e317))

## 0.106.0

### Minor Changes

- 9aa03a5: socket mux bounds, request ceilings, stop timeout, scroll restore, numeric and composed bind:value, and keyed rows kept across patches (16.78, 18.28-18.32, 30.29-30.31, 32.58-32.62, 32.66, 32.67, 42.17) ([`301bf47`](https://github.com/briancray/abide/commit/301bf47adf5059271b439fe3c129963861dd1c72))
- 9aa03a5: block tags and template context, cited clauses on diagnostics, lsp references and completions, derived answer schemas, and a scaffold with a handler and its test (32.63-32.65, 38.112-38.118, 19.21-19.24) ([`4f86359`](https://github.com/briancray/abide/commit/4f86359c7f995e2ec8c7b71d1bce5bae4cccc465))
- 9aa03a5: publish @abide/harness, with abide's bench and e2e moved to abide and the arms to the docs app (43.1, 43.21, 43.23, 38.119) ([`8521bd7`](https://github.com/briancray/abide/commit/8521bd7b364d998a1a59f764b51b34cf273f7a84))

### Patch Changes

- 9aa03a5: a render's scope is held while the values it seeded are in flight, so a joined stream closes (41.13) ([`09d7aa0`](https://github.com/briancray/abide/commit/09d7aa040d20205dddd5c8de19a425523f5124a4))
- 9aa03a5: an error page's document is marked, so the browser hydrates no page over it and leaving it is a document load (35.18) ([`28daeed`](https://github.com/briancray/abide/commit/28daeed1468c8f466c722d177a5abbf5afaf333a))
- 9aa03a5: url() takes a union of route literals with optional params ([`3cd7683`](https://github.com/briancray/abide/commit/3cd76831f9dc0867b9a2f8576803ca9ddcac845e))
- 9aa03a5: a mutation called twice in one turn is two writes (16.7) ([`60c5915`](https://github.com/briancray/abide/commit/60c5915be24e843eee0671fa0db444aeb8a69525))
- d42dfad: @abide/abide/test preloads no build from a workspace's root ([`c76a54e`](https://github.com/briancray/abide/commit/c76a54e3ddaf03d42c5534dee97c124856d063fb))
- 9aa03a5: a request with no args is held to a derived args schema, so a missing required member is refused (19.9) ([`e8e65f9`](https://github.com/briancray/abide/commit/e8e65f9ac7de561deb649b19c792ca31dd816008))
- 9aa03a5: a checker releases the snapshots it replaced, and abide lsp closes an app's checker once none of its pages is open ([`fc19c96`](https://github.com/briancray/abide/commit/fc19c965fb2ef5abdc873279a1091806f2745ac9))

## 0.105.1

### Patch Changes

- fdfe14c: an emptied list clears its region in one write ([`b190cd1`](https://github.com/briancray/abide/commit/b190cd19cd5cf0bda5797a6308eddb5ada1af13b))

## 0.105.0

### Minor Changes

- 98e55a3: the app is laid out once per compile, hooks are read by what a module imports, and abide lsp reports the tree's refusals (37.1, 38.34) ([`3b3c6c2`](https://github.com/briancray/abide/commit/3b3c6c277f9cc65a9b08a0d3b4115e7ff8e7c3c5))
- 98e55a3: a child whose setup made a call is built after the turn, as a page is (41.28) ([`6ae9acd`](https://github.com/briancray/abide/commit/6ae9acd75855b446de1680e4413deb47e0a223d9))
- 98e55a3: a component's <head> follows the component, and an unkeyed contribution replaces in place and leaves with it (39.13-39.16) ([`8dc5e9e`](https://github.com/briancray/abide/commit/8dc5e9e22054a13bb7fa648ef7df11a243f19639))

### Patch Changes

- 98e55a3: streamed answers end with their run, carry X-Accel-Buffering, and sse is read by its fields (16.75, 16.76, 16.77, 18.27) ([`696c5cb`](https://github.com/briancray/abide/commit/696c5cb61cbeb0d83382d742924ff8a35cd14339))
- 98e55a3: a command means one app, reports its first build on stderr, and abide openapi prints to stdout (38.25, 38.110, 38.111) ([`7ca9f4b`](https://github.com/briancray/abide/commit/7ca9f4b90294ca34f55c0ce3a725a336f8c1f11b))
- 98e55a3: an unkeyed reactive with a store built outside a request reads it lazily (11.71) ([`acf9440`](https://github.com/briancray/abide/commit/acf94407f779617d63cdc7ed5f371870d58e151e))
- 98e55a3: a query record and an rpc's URL args share one spelling (30.28) ([`b8c3c48`](https://github.com/briancray/abide/commit/b8c3c48b1c3b056d7172f7aad4b2f1a184b39689))
- 98e55a3: a keyed list's row record lives with its nodes in rows.ts ([`e37bbb1`](https://github.com/briancray/abide/commit/e37bbb170685cb2714584287d22946c229050781))

## 0.104.0

### Minor Changes

- c95d974: Breaking: for await over a reactive is one run ([`0013bd0`](https://github.com/briancray/abide/commit/0013bd0a279bc73cbd5d5db3f4424bd2a2418fac))
- c95d974: Breaking: mcp publishes every handler as a tool ([`a983075`](https://github.com/briancray/abide/commit/a98307582cc388f38c3d2377e176f74fe41b63da))
- c95d974: Breaking: a hook called outside a .abide or a handler file is a build error (37.13) ([`c03e97c`](https://github.com/briancray/abide/commit/c03e97c05d27db709ecb02ad06a53574b1c98ee5))
- c95d974: a server directory nests under lib or tests (23.16) ([`f928540`](https://github.com/briancray/abide/commit/f928540ecbe57af94c780a2b73c7109ef87faa52))

### Patch Changes

- c95d974: every spelling of a handler file import is the face the server mounts (16.2) ([`1e2e721`](https://github.com/briancray/abide/commit/1e2e72171950f7b3d0144fbe12b4e6d35c226fbd))

## 0.103.0

### Minor Changes

- dc5611c: BREAKING: a file is its segment. A page is the `index.abide` in its directory, and `src/invoices/index.abide` answers `/invoices` — `page.abide` is gone. A `.ts` beside the pages is a handler file, its handler its default export (`export default GET(…)`), answering at its own path: `src/invoices/getInvoice.ts` is `/invoices/getInvoice`. A `.abide` no longer exports: a handler a page alone calls is a `const` in its `<script server>`, private, answered below `/__abide/handlers/`, and listed nowhere. Code that is no address lives under a `lib` directory and tests under a `tests` directory, beside the pages they serve; a `.abide` under either is a component whatever it is called, and anything else directly in an address directory fails the build. The desktop launcher's options come from `onLauncher(…)` in `src/launcher.abide`, and a layout's or a page's menus from `onMenu(…)` in its `<script>`, in place of the `launcher` and `menu` exports. `abide sync`, `.abide/types` and the `rootDirs` the scaffold wrote are gone. New: `abide routes` prints every address and hook with the file behind it, and `@abide/abide/test`, preloaded by the scaffold's `bunfig.toml`, lets a test import the app's `.abide` and handler files as modules with nothing booted first.

### Patch Changes

- dc5611c: `abide check` reports an export or a top-level `await` in a `.abide` another one imports at that file, rather than stopping, and reports every refusal the whole app raises — a handler file's, two files at one route, a stray `onLauncher` — at the file that raised it. A mounted package's `server` directory is fenced from the browser's bundle as the app's own is. `abide routes` lists a hook called as a member (`server.onStart(…)`). The language server walks the app once per change rather than on every check, and a build no longer reloads the checker's project for each of the app's own handler files. `abide scaffold` writes the test preload's `bunfig.toml` and the `.gitignore` itself, so a packed release cannot drop them, and adds a `routes` script.

## 0.102.0

### Minor Changes

- e4e4e01: a stack trace from code in a `.abide` names the `.abide` and its line under `abide dev`, `abide start` and a compiled executable, and the client bundle `abide dev` serves carries a source map into the `.abide`
- e4e4e01: `abide sync` writes the types a plain `.ts` reads a `.abide` by, with no checker and no build; the scaffold runs it on `bun install`, and `abide lsp` keeps an open file's types current as you edit
- e4e4e01: a plain `.ts` importing a name a `.abide` exports is typed: `abide check`, `abide dev` and `abide build` write each file's exported types to `.abide/types`, which the scaffold's `tsconfig.json` reaches through `rootDirs` and `paths`
- e4e4e01: a file imported `with { type: 'text' }` from a `.abide` is its text and typed `string`; a `<script server>` may import what its `<script>` imports; children slotted into a component see its `reactive.share` in the browser as on the server; `bind:value` on a path writes back through the path; a list over a `Map`'s values shows a `patch` written through `get`; and a component's `<head>` titles the page after a client navigation
- e4e4e01: A package can ship pages, layouts, error pages and handlers, and the app decides where they answer: `import 'kit/admin' with { type: 'routes' }` in any of the app's `.abide` mounts every `.abide` under the package's `admin` directory at that file's directory. A directory mounts once; mounting one of the app's own, or one that is not there, fails the build. One classifier, `placeOf`, now answers where every file sits, and a name the framework reads off a `<script module>` export is read off the loaded module when it is needed (34.32) — the desktop `launcher` is read as the app launches, not during `abide bundle`.
- e4e4e01: BREAKING: an app is laid out by subject. Every directory under the root is a segment of an address, and a `page.abide`, `layout.abide` or `error.abide` answers at its directory's path — `src/billing/page.abide` is `/billing`; a `server` or `public` directory is never a segment. Handlers are exported from a `<script server>` block in any `.abide` outside those two, and answer at the directory's route plus the export's name — `.ts` handler modules and `src/server/app.ts` are gone, and the root `layout.abide`'s server block holds the app's hooks. `middleware` and `onError` are scoped to their file's route, `onConfig` and `onPrincipal` compose, path params merge into a handler's args, a `server/` directory is fenced from the browser, `public/` directories mount anywhere, and the one import alias is `#src/*`. The desktop launcher's files leave `src/bundle/`: `src/launcher.abide`, beside the root layout, exports its options as a typed `launcher` from its `<script module>`, read as the app launches (no more `launcher.json`, and the app is named by its package), and the icon is the public file at `/icon.png` or `/icon.icns`. The built-in launcher is the icon, the name and a Start and a Connect… button, each opening its form in a dialog, colored by the most saturated hue of the icon.
- e4e4e01: a refusal that reaches a jsonl or sse stream after it answered — a stalled stream's 504 among them — is sent as the stream's last frame and refused by the browser's copy after the chunks it had, rather than read as a dropped connection; a handler's `timeout` now raises the idle timeout a socket tick past itself, so that frame always goes out first

### Patch Changes

- e4e4e01: `abide build` removes a public file the app no longer has from its output, so `abide start` stops answering it. The desktop launcher's Connect… menu item opens the connect dialog again, and `Launch.focus` is the form the page opens on, `undefined` for none. `abide lsp` keeps its scan of the app between checks until its watcher hears a file move, and a compile resolves each `.abide` import once.

## 0.101.0

### Minor Changes

- 128f192: Breaking: an rpc export named as its file answers at the file's path ([`9758128`](https://github.com/briancray/abide/commit/97581285b14d6d01688c963a4332729f6af30d3a))

### Patch Changes

- 128f192: the executable carries the app as bytecode ([`4a72909`](https://github.com/briancray/abide/commit/4a729091955a28df259005b79109ee2e00593046))
- 128f192: followers are filed by entry key, and an SSE event is read off its frame ([`7a137e7`](https://github.com/briancray/abide/commit/7a137e7224daf334c90539c75bb4f7ff25701dc8))
- 128f192: a request's signal aborts when its caller hangs up or its worker is replaced ([`7a57131`](https://github.com/briancray/abide/commit/7a571311b08e2c4d3b14c244395bc7cc29fad4d7))
- 128f192: a page loads only the framework modules it uses
- 128f192: disposed readers are counted rather than found, and the probe edge is cursored ([`ef1bafe`](https://github.com/briancray/abide/commit/ef1bafec810f06bea37a88c51713ac2b92e212e7))
- 128f192: answers of 64 KB or more are compressed off the event loop ([`f484e0d`](https://github.com/briancray/abide/commit/f484e0d140321d9cf2a171cb52dec0b0a3b2c227))

## 0.100.0

### Minor Changes

- 12e5725: Breaking: the rewrite. `@abide/abide` is now the isomorphic, type-safe framework for reactive async interfaces built from compiled `.abide` files — a new surface, not an upgrade of 0.58. Apps import `@abide/abide`, `@abide/abide/runtime` and `@abide/abide/server`; `abide scaffold <name>` writes a starter. The 0.58 line lives on the `og` branch.
