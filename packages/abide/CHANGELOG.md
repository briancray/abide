# @abide/abide

## 0.145.0

### Minor Changes

- as narrows a column's type on the typed table, and sql's values admit a plain object — 47.52, 47.54 ([`0fe5eb6`](https://github.com/briancray/abide/commit/0fe5eb62a4333609e1ad1ea0c06352c9111de7c6))
- peek, insert, like, undefined left unnamed, nothing opened until used — 47.50-47.53 ([`f6b60d9`](https://github.com/briancray/abide/commit/f6b60d94b34039cc61c49644a5a4bd1e679abde4))
- fb32791: A `pipe`'s `backoff` function is handed what the attempt before the retry failed with — the refusal it answered or what it threw — beside the retry's number, so a 429 can wait longer than a 503 (RULEBOOK 57.10). A third party's `Retry-After` already reaches a pipe through `fetchAndHandle`'s `FetchFailed`, and is now proved to.
- 240c0ed: A blank text arg for a member declared neither `string` nor a list is read as absent, or as `null` where `null` is declared (RULEBOOK 19.30): a `form`'s optional number field left empty, and a query's `?miles=`, no longer refuse as "must be number, was string".
- 425d699: `chart` takes `xAxis: 'values'`, standing its x ticks at round values across the x range rather than at the positions, and `xZero`, taking zero into the x range with a line down the plot there as `plot.xZero`. Every x tick now carries its `value` and a `grid` line down the plot, a tick at a round value an `index` of `undefined`, and the y gridlines and zero line carry `data-axis="y"` (RULEBOOK 52.25, 52.120, 52.121).
- 34330c7: `componentGraph` from `@abide/abide/compiler` answers the set of invoked paths itself, rather than `{ invoked }` around it: `const invoked = componentGraph(files, resolve)`
- fbc98e7: A `drawer` given `stops` follows a drag by a `transform` alone, carrying `data-following`, and is sized once it is let go: the drag is stood at its largest stop once and lays nothing out per move (50.63). Let go, it is pushed to its stop and sized when the app's CSS transition on that `transform` ends, at once where there is none — so `[data-drawer=drawer]:not([data-following]) { transition: transform .18s }` animates the settle (50.85). A tap on its handle, a press let go within 8 pixels, stands it at the next stop, going round (50.84).
- e0d56ec: `abide check` and the build refuse a statement that makes a refusal and keeps nothing — `refuse(404)` written without `return` refuses nothing and runs on (15.10)
- e279505: `fetchAndHandle` takes `as: 'response'`, answering the `Response` itself once it is 2xx with its body unread, for a header the answer carries; a status outside 2xx still rejects with its `FetchFailed` (RULEBOOK 54.10).
- 01454d8: Breaking: `fetchAndHandle` makes one request per call and takes no `timeout`, `retries` or `backoff` (54.7) — asking again is a `pipe`'s (57.9), and a deadline is `signal: AbortSignal.timeout(ms)`. `FetchFailed`'s `timeout` reason is gone, and a `FetchFailed` is transient by the status its service answered, so a `pipe` or a `memo` no longer asks again after a service's 404 (15.19). `abide upgrade` spells a `timeout` as the signal, drops `retries: 0`, and names each retry left for a pipe (38.234)
- 77bfdc1: A `form` field whose own name has no issue takes the first issue beneath it as its `message`, so a structured member posted as one field — `positions` as JSON (19.27) — shows the issue at `positions.0.shares`, and is `aria-invalid` and focused as any field with a message is (56.36).
- 8c68122: `form(handler, { resetOnSuccess, onsuccess })`: a create form starts over once its call answers without a failure, rather than keeping what it sent as the fields' baseline (56.34), and `onsuccess` is handed what the call answered once the fields have moved (56.35). A form's `message` is also a failed call's own message where the failure names no field — a 401, a 409 (56.13).
- 40db88d: Every option a headless component binds takes a `Bindable` — any `{ get, set }` pair, which a `Reactive` is — so a pick can write somewhere other than one value (a filter moving the address, a choice saved through an `rpc`) without a derived value and a `watch` bridging the two (49.8)
- abfdd44: A `hotkeys` binding may name its key by where it sits: `KeyQ`, `Digit1`, `mod+KeyK`, `Slash` match `KeyboardEvent.code` whatever the layout types there, so a French keyboard's A-where-Q runs `KeyQ` and its `&` runs `Digit1` (53.6). `keyLabel` and a `MenuItem`'s `key` read such a binding as the key it types on a US layout.
- 1e552bf: A `job`'s run is handed, beside its input, a `progress` function writing how far it has got into `JobStatus.progress` — `undefined` while no run is going — and a `job` takes `throttle` to pace its status writes as a `memo`'s owner is paced (54.42, 54.43).
- 5e76ab6: `memo` takes `staleIfError`: an entry whose `ttl` runs out with nothing subscribed is kept that much longer, and the call that reaches it revalidates it in place, answering what it held where the revalidation fails — 6.6, 6.7, 6.8, 6.9. A memo's call takes `{ signal }` as an `Rpc`'s does, so a run every caller left is ended, its `abortSignal` with it — 11.83, 11.84, 7.23. And a call of either whose signal aborts is refused `Aborted` at once, while the load goes on for the calls that remain — 16.120
- 143db68: `Memo` is typed `Memo<Value, Args, Failures, Produced>`, value first as `Rpc` is, and its call answers a `CallAnswer`: `Memo<undefined, JobStatus>` is now `Memo<JobStatus>`. A memo's `schema`, `args` and `transform` refusals are in its failures, so a derived `reactive` over a call and an `rpc` over the memo are typed with them, and `rpc` and `memo` take one `MemoOptions`
- 7889dff: `prompts.prompt({ input: { maxlength: '60' } })`: a prompt's `input` names attributes `prompts.host`'s `input` part carries — a `maxlength`, an `inputmode`, a `pattern` — under the ones the host writes itself (50.83).
- 8fe38de: Breaking: `reactive.derived` is `reactive` handed a body. `reactive(value)` holds a value, and `reactive(() => …)` takes and does everything `reactive.derived(() => …)` did. A function handed to `reactive` now runs as a body rather than being held (4.20); a function to hold is what a body hands back, `reactive(() => format)`. `abide upgrade` wraps each function an app held in `reactive` in a body (38.232), then spells every `reactive.derived` as `reactive` (38.233).
- 40db88d: BREAKING: a `Reactive` is no longer callable — read it with `s.get()` (1.9, 31.7). Inside a `.abide` file a name still reads by name; `x()` on a name bound to a `Reactive` now calls the value it holds (31.11), the way `onsave()` on a prop already did. In a `.ts` file, `count()` becomes `count.get()`
- c07e4ac: The report dialog `ReportDraft.open` shows carries no stylesheet and no `abide-report` class: its pieces are named `data-report="dialog"`, `"preview"`, `"status"` and `"actions"`, for the app's own stylesheet to style, as a headless component's parts are
- b597b29: `route.query('tab', 'deals')` answers one member of the query as a `Reactive` of its own, typed as its default, for a part that binds a value — `tabs({ selected: route.query('tab', 'deals') })` — with a write that member's alone (30.49).
- 877fb20: Breaking (types): `s.set` refuses a `Reactive` whose failures are not this value's — it used to pass as any thenable does (11.69)
- 8482505: A database's tables are typed from its migrations and described by the file itself. `database` carries the tables its `CREATE TABLE` / `ALTER TABLE` / `DROP TABLE` strings leave, so `table(db, 'deals')` is typed with no generic and a misspelled name is a type error, and `Tables<typeof db>['deals']` names a row (47.48-47.50). A `table` writes by the table's own primary key, composite ones included, rather than `id` (47.30, 47.40); a column declared `BOOLEAN` reads as `true`/`false` and one declared `JSON` as its parsed value, through a table, its changes and `sql` (47.41, 47.42). An `IN` list of any length binds in one statement per power of two, and one past 1024 values as a single JSON value, so a call site no longer prepares a statement per length or fails past SQLite's variable limit (47.37). `logged` keeps wide columns out of the change log (47.43); a write inside a transaction refreshes on its commit (47.44); a reader is never handed a gap (47.31, 47.45). Migrations run with foreign keys checked once at the end, so a table rebuild no longer cascades (47.46), and `database` opens with `synchronous = NORMAL` and keeps the planner's statistics with `PRAGMA optimize` (47.5, 47.47). A table also has `peek` (a read nothing follows), `insert` (the key left to SQLite, the stored rows answered) and `like` in a match; a plain object in `sql` binds as JSON; a column given `undefined` is not written; and declaring a table opens no database until it is used (47.51-47.39). `.as<{ col: Narrower }>()` narrows a JSON column or a text union on the typed table (47.54); triggers a rolled-back transaction unmade are made again (47.55); and an update that changes nothing records no change (47.56). Behavior changes: a `table` with no `key` whose primary key is not `id` now upserts by that key, and `BOOLEAN`/`JSON` columns read decoded.
- 62bae53: Breaking: a change to a table refreshes the values whose last run called that table — no longer every value whose `tags` name the table. A handler serving a table's rows to browsers live is `global`, as a table's own `rpc` is; a read through `sql`, or a view narrowed to its caller, follows nothing on its own: tag it, and refresh the tag from what writes (47.29)
- 530ed34: `toggleGroup({ deselectable: true })`: picking one, a press on the item picked unpicks it, leaving `value` `undefined` — a filter that is one at a time, or none (51.112).
- f3cde2c: `tooltip.tip`'s text is markdown. `tooltip.host` hands back `html`, the hint rendered with every link as its text and a heading at level 6, for an app to write with `raw`, and `text` is now its plain text, as is the anchor's `aria-description` and a `pie` slice's (RULEBOOK 50.23, 50.54, 50.86, 50.87).
- 90e0023: A headless component picks by its items' keys as they are: `toggleGroup`'s `value`, `tabs`' and `carousel`'s `selected`, `listbox`'s, `tree`'s and `sortableList`'s `selected`, `sortableTable`'s `selected`, `tree`'s `expanded`, `sortableList`'s `order`, `wizard`'s `current` and `accordion`'s `open` are typed by what `key` answers — the item itself, or its `id`, where none is given — so a number id is picked as a number, with no string copy and watch converting back. A key becomes text only in an element's id. `playback`'s speeds are keyed by the rate itself (49.21, 51.134).

### Patch Changes

- bfb0b4f: ABIDE.md, the agent guide every scaffolded app imports, declares handlers with `rpc` and says a `<script server>` exports its private handlers as bare values, rather than the removed `GET` / `POST`
- 90bbeec: A keyed entry keeps the args of the call that made it: a caller changing its args object afterwards no longer changes what a refresh of that entry runs with (16.43)
- the codemods splice through one helper, and the one-value options leave ([`0837bd0`](https://github.com/briancray/abide/commit/0837bd019877a174cfdb54b6207aba1db136a44d))
- format the server files their named rpc exports lengthened ([`095d988`](https://github.com/briancray/abide/commit/095d988657d7d8a257848f7dc08c408525733624))
- pipe settles a step's answer in one arm, and three names drop an export ([`188ad28`](https://github.com/briancray/abide/commit/188ad283eeca3fe233bf50bea0d9833dc962cfcc))
- the fetch-options migration reads abide's bindings through abideBindings ([`1b0df27`](https://github.com/briancray/abide/commit/1b0df27dddf3432cf2e1545c81999fb79ca334c6))
- a bind:group and a multiple select write only what moved — 32.8, 32.62 ([`1b3a90a`](https://github.com/briancray/abide/commit/1b3a90abac91feb0cf4039563d1b1628bbfd3653))
- the last hand-rolled splices and import list go through the shared helpers ([`1dcea8c`](https://github.com/briancray/abide/commit/1dcea8c2e83fe0c6cec3e1373e39fc87f8fcc7ed))
- headless parts compose through what they share ([`34826e8`](https://github.com/briancray/abide/commit/34826e843ca987a6973bbc2a6a78a2a1a42b3c86))
- a call to a memo or rpc takes the stable arm every read takes — 11.74 ([`351d4f7`](https://github.com/briancray/abide/commit/351d4f7edd8a4449fc38a652f5f2b8a03c797089))
- comments, notes and dead branches the rpc and reactive(fn) moves left behind ([`582e168`](https://github.com/briancray/abide/commit/582e16868c7453a08e969e5eb96e0868b4bcfe84))
- the OpenAPI and MCP surfaces are plain values kept per route table, not Reactives ([`5908cdd`](https://github.com/briancray/abide/commit/5908cdd7ce7a176b24802e794754626185fd0ccb))
- a checked raw(x) is abide's raw by what the local name imports — 32.25 ([`6e17789`](https://github.com/briancray/abide/commit/6e177892f37e20a5ea09a06057fbcfba41fe534c))
- an rpc over a streaming memo is a memo too — 16.6 ([`6e50717`](https://github.com/briancray/abide/commit/6e507173cc13f6f3c0bff64b585cb171c91aad3e))
- template front simplifications ([`6eee336`](https://github.com/briancray/abide/commit/6eee336656ad45d5dec20e9bf608facb8bf19e24))
- abide's own handlers are declared with rpc, as an app's are ([`7243cf2`](https://github.com/briancray/abide/commit/7243cf23eb2fe1e6adf2d5c58a12f912df1f2427))
- listbox lists its keys through itemKey, and three adapters leave ([`7564db3`](https://github.com/briancray/abide/commit/7564db3d3f4afd76b1b7c1d79a4e225cc73f9b31))
- a handler file named for a reserved word keeps its default rather than exporting const delete — 38.231 ([`78188d3`](https://github.com/briancray/abide/commit/78188d3e2f2475e9dc68cc8d96fa6c2e25f2875c))
- one RFC 6901 token escape ([`802e95c`](https://github.com/briancray/abide/commit/802e95ce29d27071fa1e7ed6c2ab5f54ffd3537f))
- a readable after a cancel is new, starts past what was removed, and follows its opener to the same log — 47.27, 47.44, 47.57 ([`8300b81`](https://github.com/briancray/abide/commit/8300b81655f9a9781dccb210443da9ae7a367048))
- the build's brotli, a table's path and the fallback version are each written once ([`8db93de`](https://github.com/briancray/abide/commit/8db93debe7ae1818e41cd94b8308a5f8bf38274e))
- Revert "fix(check): a Reactive declared inside a function is read and written by name — 31.1" ([`96bb0e0`](https://github.com/briancray/abide/commit/96bb0e01c08c5caf265f65a5e02225655394dce1))
- an update that changes nothing is no change, so a self-assigning upsert logs and refreshes nothing — 47.56 ([`9991deb`](https://github.com/briancray/abide/commit/9991deb5301127fdd84a0869b338456a2cfb651a))
- brotliOffLoop takes a quality, and bin imports no zlib ([`9f5299e`](https://github.com/briancray/abide/commit/9f5299ed656ddab5bd516ba9fbfb6d4cdf5fc98f))
- a module's value is built once every onConfig is filed — 11.82 ([`a3e80ab`](https://github.com/briancray/abide/commit/a3e80ab6023e62a2fad239a3b5f7601918088e6c))
- a key is inferred from what value holds, and a list of text picked by a union of its words needs no key — 49.21 ([`a7c0bed`](https://github.com/briancray/abide/commit/a7c0bed358b3bd90c8bf7300e624ef5c9c62d330))
- a table's options never type its row, so logged keeps a typed table typed — 47.47 ([`ae8c105`](https://github.com/briancray/abide/commit/ae8c105454e707518ef7872ac8e45fd77be7b482))
- a replacement whose diff is one root replace is sent as the value — 18.41 ([`b7a6595`](https://github.com/briancray/abide/commit/b7a65950ace095e78d0b7c1f96ee5328c49ad23a))
- one jsonl line and one cookie read ([`c78f2af`](https://github.com/briancray/abide/commit/c78f2af578e430f73a9b2ef373706028cc7c2d36))
- a rewrite over script blocks needs no module arm of its own ([`cc5cc97`](https://github.com/briancray/abide/commit/cc5cc974a8cd2b11ed9ab49095c3200e45b93e06))
- an expression node carries its own rcdata — 35.9 ([`ccbc83b`](https://github.com/briancray/abide/commit/ccbc83b561dac7047bbdd09fc1aa1cd9ef48adc6))
- drawer and the CRM's sheet and stage-key tests as bun fmt writes them ([`da79281`](https://github.com/briancray/abide/commit/da792810c25a932be6b44b7184b30a1f5e47ce72))
- the check side reuses what it already has ([`f10c1f0`](https://github.com/briancray/abide/commit/f10c1f02328a3c57f88a3c4c197ad79813d35fd5))
- citations name the clause a test proves — 2.10, 34.9, 36.18, 41.31, 53.42, and the neighbors ([`f2723cb`](https://github.com/briancray/abide/commit/f2723cb96dc975e2952ad87a194353d7d49fc942))
- answeredValue is a call's value, answered over answerOf ([`f28db8b`](https://github.com/briancray/abide/commit/f28db8bd1165a148c2de9d29ed369db73d7caa85))
- triggers a rolled-back transaction unmade are made again at the next reach — 47.55 ([`fbbbc8b`](https://github.com/briancray/abide/commit/fbbbc8b8895cadae56562613f728c815c91c1e01))
- headless parts list their keys and write their side through one helper each ([`fbeda61`](https://github.com/briancray/abide/commit/fbeda61876a842b14c71c0c43f09644ae099b0ff))
- format the typed-key files ([`fc84b8c`](https://github.com/briancray/abide/commit/fc84b8c87e39e0c66f58a93a9305560290826ab1))
- the codemods read abide's bindings through abideBindings ([`fd0505f`](https://github.com/briancray/abide/commit/fd0505f994f4630228166f7b4002e85f8f0da5a0))
- 1a00262: `chat`'s `messages` takes a `Reactive` with any failures, so one adopting a handler's call — which carries `HttpError` — binds without a cast. While it is failed, `failed` is its failure's message and the composer sends nothing (RULEBOOK 53.47).
- fb92896: `abide check` no longer reports TS6133 on a generated `__valuesN` record when an inline component's or a branch's `<script>` only hands a prop on as its `Reactive` (for example `toggleGroup({ value: method })`): a body's record is declared only when something reads through it (RULEBOOK 38.138).
- 78331e2: An id a headless component makes where none is given is counted per render, and per page hydration in a browser, rather than drawn at random, so hydration makes the id the server wrote and an attribute written off a part's `id` names the part (41.36).
- 82c0967: A `dialog` opened beside the page (`modal: false`) that is not `dismissible` leaves an Escape to the page, its default not prevented, so the page's own keys still hear it (50.3).
- 999dbd4: under `@abide/abide/test` each test starts cold, not each file: an answer a test settled — one a rung admitted its signed-in caller to included — is not served to the next test — 38.133
- 90bb2bc: A copy's face members (`set`, `patch` and the other writes an `rpc` answers) send through the same path as every call: a member whose handler signs the caller in or out refreshes every tab (26.24), and one that reaches no server answers `HttpError` at 503 rather than the browser's `TypeError` (16.79)
- 5353112: a followed copy takes a replacement the server sent as its JSON Patch (18.41) as a new value, so what a page read from it before is left as it was and each part the patch does not reach keeps its identity; an `s.patch` is still written in place — 18.49
- 5753219: A browser stops following a `GET`'s copy once nothing has read it for 30–60 seconds, leaving it stale so the next read fetches it and follows it again; a page no longer keeps a follow open for every copy it ever loaded (18.48)
- 242abb0: A `form` field's `input` names its `error` in `aria-describedby` only while it has a message, so a field whose error element is never rendered — a hidden input's — no longer names an element the document lacks (56.9, 49.7).
- 9fba0e6: `popover`'s and `dismissible`'s `escape` and `outside`, and `dropzone`'s and `chat`'s `accept`, take a function read where it is used, as every other value option does (49.10)
- ee4a643: A followed value declaring a `key` is diffed in n log n rather than n² per production: a 10,000-row reorder sends its patch after 1.6 ms of diffing, where it took 83
- 8f52d76: `listbox`'s `option` — and so `combobox`'s and `commandPalette`'s — hands back the same listeners for a key at every call, and each row reads its own active and selected state, so an arrow step wakes only the two rows it moves the mark between and binds no listener again (RULEBOOK 51.192).
- c9a246e: A media type is read case-insensitively where the server decides by it: an answer typed `Text/HTML` carries the content security policy, and a form posted as `Multipart/Form-Data` is read as a form
- 0333bdd: a mounted page resolves the document's address against its own route: `route.params` is what the route matches, and `route.name` the route — 38.235
- 300fae3: a mounted component stands at the document's address — `route` resolves in both halves — and navigates through a router the mount installs, written to `history` — 38.235
- 0f042bc: A `Reactive` declared inside a function, a method, a block or a listener in a `.abide` file is read and written by name as a top-level one is — `takes(inner)` hands `takes` the value, both as it runs and under `abide check`, where it handed over the `Reactive` itself and `check` reported TS2345. And a binding is a `Reactive` only where it is one as the file runs: `const [held, day] = [quest, today]`, `pick(quest)` or a loop's item over a literal that read its member holds the value, at the top of a script or inside a function, where it was called as a `Reactive` (31.1)
- 2cbd1ba: A `Pipe` called with a signal ends its item on that signal alone, rather than on it joined to the `abortSignal()` of the place it was called from. A lane called for work many requests share — a job started in the first requester's request — no longer fails for everyone when that requester leaves; called with no signal, an item still ends where its caller's run or request does (RULEBOOK 57.13).
- bb6e8e7: `playback`'s `root` leaves a press on a control inside it to that control: Space on a button presses the button and an arrow on a slider moves the slider, rather than the clock too (51.135).
- 6a43885: A value inside a `<textarea>` or a `<title>` renders as its text, a `raw` value as its source: the server no longer writes a raw run's anchors there, where they showed as text, and the client no longer parses its markup away (35.9)
- b8cf643: `rpc` over a `memo` whose args are optional is called without them again, as the memo is: `rpc(memo((args?: { type?: string }) => …))()` no longer asks for its args (16.6).
- 13dfada: An `rpc` a server file exports by the file's own name answers at the file's path, as its default does — `export const getDeal = rpc(…)` in `deals/getDeal.server.ts` answers `/deals/getDeal` — and a file exporting both is refused at build (16.2). `abide upgrade` exports a moved handler file's default by its file's name, and imports it by that name (38.231). The docs, the CRM and the scaffold name every `rpc`.
- 9292992: `rpc` given an `rpc` is a type error, as it already threw where it was declared (16.119)
- 5728128: a rung reads `ctx.request` when it reads it, so a handler whose rungs never do runs in an `App.run` made without a request — 16.121
- 25577ff: A `<script server>` exporting a generator (`export async function* ticks()`) answers it at its private address, as it does any other export it declares; the build had read the exported names through a second walk that skipped a generator
- 9f63bae: A member of an element's `{...expr}` whose getter reads a value still in flight aborts its own attribute rather than the spread: the server renders the rest of the spread and of the page, and the browser keeps what that member last wrote until the value lands. A headless part's getter over unlanded `options` or `items` (a `listbox`'s `aria-activedescendant`) now waits as a `{#for}` over the same value does (32.117).
- 2ea2c43: A headless part's stand-in `Reactive` (`tabs.selected`, `wizard.current`, `calendar.month`) peeks untracked, as any value does: a body that peeks one is no longer rerun by a write past it
- ceb3b83: `slider` lands a value in its step's decimals, as `spinbutton` does — a step of 0.1 from 0.6 is 0.7, not 0.7000000000000001 (51.86). A `dialog` opened with `modal: false`, and so a `drawer` beside the page, closes on Escape from focus inside it, which `show` never fired a `cancel` for (50.3).
- 9675b3a: `table` opens its database at its first call, write or stream rather than where it is declared, so a module declaring one before the app is configured opens the database the config names — 47.39
- 86881c2: each test under `@abide/abide/test` is one browser session, signed out as it starts — a test or a mounted component's call signs it in with `principal.set`, and `principal`, `cookies`, `request` and a handler's rungs read it outside every request; `settled` no longer waits on a value nothing reads whose load waits on nothing — 38.236, 38.204
- bcae040: a `{#try}` whose `{:pending}` arm the server painted takes its catch where the first load refused before hydration or after it, rather than showing "loading" for good — 32.16
- ebf31be: `abide upgrade`'s `computed` migration drops an import it empties with the blank line under it, as the other migrations do, rather than leaving the module opening on a blank line
- e4d5fb0: `abide upgrade` rewrites a script block written in capitals or closed with a space (`<SCRIPT>`, `</script >`), as the compiler reads one
- 2c9faf1: An `rpc` over a value or a source that answers writes takes `refreshes`, and each write over the wire refreshes what it names; it used to throw 16.92's refusal meant for a `GET` (16.89)
- 56ac207: A worker call's `AbortSignal` now ends the call's thread the moment it aborts, rejecting the call with the signal's reason — a loop that never yields stops all the same — and a call whose signal has aborted already, or made where `abortSignal()` has, starts no thread. A signal handed to a call is what it ends on, in place of the request's or run's, as a pipe's item does: work many requests wait on is no longer the first requester's to end. The export is handed a signal that never aborts in its place (RULEBOOK 55.6, 55.8).
- 3cc0e47: A write through a member typed as a `Reactive` is that member's: `buffer.values[kind] = path`, where `buffer` is a prop or a `Reactive` and `values` a `Reactive` member, writes `values` (31.8, 31.15) rather than writing the whole path through `buffer` as well, which compiled to two overlapping writes and threw. A `{#for}` row's item is bound as a `for…of` binds one, a name or a destructuring pattern (32.116).
- Updated dependencies
- Updated dependencies
- Updated dependencies [660c375]
- Updated dependencies [b5e98bd]
  - @abide/bridge@0.9.2

## 0.144.0

### Minor Changes

- 8562d19: Breaking: three headless components take their WAI-ARIA names — `stepper` is `spinbutton` (`Spinbutton`, `SpinbuttonOptions`, `data-spinbutton`), `pages` is `pagination` (`Pagination`, `PaginationOptions`, `data-pagination`) and `range` is `slider` (`SliderOptions`, `SliderParts`, `SliderEnd`, `data-slider`). Behavior is unchanged.
- a8ce49b: a headless component a refused write leaves as it stood — 49.19 ([`0177380`](https://github.com/briancray/abide/commit/01773807eebda6e4ea6e7c3937fe69dbbc6726e7))
- a8ce49b: combobox create lists typed text as a new item, and a refused pick leaves the field and list as they stood ([`2cd0261`](https://github.com/briancray/abide/commit/2cd0261d5b27db82240fb5e44a8e3312c2f145cf))
- a8ce49b: Breaking: a memo and a value answer GET alone until methods names their writes; an rpc's members are typed by the verbs it answers (16.111, 16.117) ([`650d708`](https://github.com/briancray/abide/commit/650d708354b64d2ea0b130e1bfad591b8390e7eb))
- a8ce49b: every server file answers its rpcs at its own path, a lib directory's among them; one exporting none is a module — 16.73 ([`8bd9fda`](https://github.com/briancray/abide/commit/8bd9fda1c2aada296d700b85671cbe965a94e437))
- a8ce49b: Breaking: memo is the function remembered — it answers what its function answered, per key, and a computed calling it follows the key (11.2, 11.75, 11.76) ([`acc04c2`](https://github.com/briancray/abide/commit/acc04c2fda91179c62f4409b655590e55242b522))
- a8ce49b: dialog, commandPalette and chat honor a refused write — 49.19 holds them ([`f68833f`](https://github.com/briancray/abide/commit/f68833facc2b2f35f66aaf90e92724f96cdba4a9))
- bddd9bb: Breaking: `breadcrumbs`' `overflow` is `menu` — the folded crumbs' `menu`, its parts handed back whole under its name (49.18, 51.139). `items` still marks the fold with `'overflow'`.
- 85b42d7: A headless component built on another merges that component's part into its own where both go on one element, carrying both `data-` attributes, and hands that component's parts back whole, as a member named for it, where they go on elements of their own — 49.18, stated once with no exceptions and now gated.
- d91ce72: chart and sparkline parts go on any element, not only SVG: the chart docs draw columns as HTML spans placed by their --x/--y/--width/--height, one tab stop on a div, with the keyboard and announcements as an svg has them — 52.81, 52.116
- b16d30d: chart and sparkline take pad — a share of the values' span, or [below, above] — widening the y range before zero is taken in and the ticks round it, so the line stands off the plot's edges without hand-padded bounds — 52.119
- befe4aa: chart, sparkline and meter parts carry where they are drawn as CSS custom properties: each placed chart mark --x and --y (a column --width and --height besides) as percentages of the root box, sparkline's dot the same, and meter's track --fraction, so an HTML mark placed by them stands right at any size — 52.116, 52.117
- 26d1c75: Breaking: the box a `chart` measures is its plot, edge to edge. It keeps no room inside it for its labels any more: the x positions and the y range span the whole box, the gridlines, the zero line and the crosshair run across all of it, and a y tick's label ends at the plot's left edge (`text-anchor: end`) while an x tick's stands at its bottom edge. Keep room for the labels on the element around the root (`pl-12 pb-6`, say), let an `<svg>` root show what overflows (`overflow-visible`), and give a label its gap from the plot (`dx="-6"`, `dy="6"`). Every position is now a pure share of the box, so percent positions are exact before the root is measured and on the server, and gridlines no longer depend on labels. `frame` is removed: the plot's edges are the box's, so a drawing across it spans `0` to `100%`. RULEBOOK 52.68 amended.
- 4215c74: Breaking: `chart`'s root part is `root`, where it was `svg` — the root may be a `div` as well as an `<svg>` — and it carries `data-chart="root"` where it carried `data-chart="svg"` (restyle a `[data-chart=svg]` selector by hand). `pie` and `sparkline` draw only in SVG and keep `svg`. `abide upgrade --from 0.143.0` renames `svg` to `root` where it is read off a name the same file binds to a `chart(` call, in script and markup (38.220); one read off a prop typed `ChartParts` is left for `abide check` to name. RULEBOOK 50.46 amended.
- da45ebb: a chart series takes format(value, index): the readout and what a key move announces write its values through it rather than yFormat, so a series scaled to share an axis reads in its own units — 52.118
- fd8daf0: Breaking: a `chart` column is placed and sized by its rect's own `x`, `y`, `width` and `height` rather than a `transform` in its `style`, so an HTML column needs no `transform-none!` and a CSS transition eases it on `x`, `y`, `width` and `height` (write `transition-[x,y,width,height]` where `transition-transform` was); and a chart whose root part is bound to an `<svg>` writes no `--x`/`--y` vars on its parts, which were 45% of a 600-mark redraw there (`bun run bench:chart-vars`). RULEBOOK 52.63 and 52.116 amended.
- 87ce7b4: Breaking: a chart's x maps a value in the units of its x option, as y maps a value — plot.x(index) becomes plot.x(value), the same where no x option is given, and a date between two positions now stands where it falls — 52.78
- d8a680e: `chat` takes `attach`, deciding what a file is sent as (`assistantMessage`'s blocks by default, a throw turning it away, an empty list dropping it), and `accept`; any block can be attached, text included. `attaching` and the composer's `data-attaching` hold while a conversion runs, and a send meanwhile waits for it — 53.37, 53.106, 53.108
- da97428: `chat` hands back `calls(handler)`: every call the conversation made to one handler, matched by its `tool` (20.24), in order and typed by the handler — `{ toolUse, input, value, toolResult, failed, streaming }` — live while it streams (53.109). A call's value is the one its `tool_result` event delivered, kept beside the block rather than read back from its words; a block no event was folded into, as in a conversation stored and read back, reads its words as JSON (44.106). `resultsOf` reads the same calls, for a conversation outside a `chat`, and now leaves out a call whose event delivered no value (44.51).
- d8a680e: Breaking: `chat`'s `draft` is the user message being written, `Reactive<AssistantMessage>`, its words and attached files as blocks in order, and `draft` is an option to bind (49.8). The input shows its text blocks and an edit rewrites them where the first stood; a file attached goes after them; `attached` is every block the input does not show, derived from `draft`. Sending sends the draft as it stands and empties it, so `talk.draft = question` puts a question back to edit and send again — 53.105-53.107. Migrate `talk.draft = 'words'` to `talk.draft = { role: 'user', content: 'words' }`.
- d8a680e: Breaking: a headless component built on another hands back that component's parts whole, under its name (49.18). `chat` hands back `dropzone` and `autoscroll`: the composer no longer takes drops itself and the transcript no longer follows its bottom itself — spread `{...talk.dropzone.host}` where files land and `{...talk.autoscroll.host}` with `transcript`; `talk.jump` is `talk.autoscroll.jump`, and `talk.dropzone.input` is a file picker.
- d8a680e: `chat` takes `onreject` and hands back `rejected`: the files its dropzone turned away and the files whose conversion threw, which it used to leave out silently — 53.37
- d8a680e: `chat` hands back `submit()`, sending what `draft` holds through the same path and guards as its composer — 53.107; and every answer, sent, queued or asked again, is asked through `ask`, so a wrapper reshaping what the model is sent covers them all — 53.31
- 51b4e03: `computed` is `reactive.derived`: the value a body produces is a member of `reactive`, as `reactive.share` is, and the `computed` export is gone. `reactive.derived(() => …)` takes and does everything `computed(() => …)` did. `abide upgrade` spells every use of abide's `computed` as `reactive.derived` and imports `reactive` where a file did not (38.228).
- 858f20f: `reactive.derived` is the derived value: `reactive.derived(() => seats() * price())` runs again when what it read changes, loads where its body is async, and streams where it hands back an async iterable. `memo` is now always keyed — one value per set of args, keyed on `undefined` where its body declares no parameter — and neither reads a body's parameters to decide what it builds. `abide upgrade` renames every `memo` handed a body that declares no parameter to `reactive.derived` (38.223).
- 93e09db: A `GET`'s `throttle` or `debounce` reaches its browser copy: the build writes it into the wrapper beside `key`, `tags` and `identity`, and the copy starts the keys a page reaches at that pace, as a `memo` does — so `reactive.derived(() => searchDeals({ q }))` over a handler declared `{ debounce: 300 }` sends one request once the typing stops, with no `memo` between them. A pace the build cannot read is warned on (16.110, 18.4, 18.15).
- bc20303: copyToClipboard writes text or a record of MIME types to the clipboard from any handler and settles whether it landed, through the textarea fallback `copy` uses — `copy` and `pairing` now write through it — 53.21, 53.22, 53.54, 53.55, 53.103, 53.104
- 99836fe: dialog, drawer and lightbox hand back a backdrop part: spread on an element inside a dialog filling the screen, a click whose target is that element closes it where it is dismissible — 50.3, 50.61, 50.65
- f4b5051: A followed value that is replaced — `set`, a refresh, a reload — reaches every page standing at the version before as the JSON Patch from the old value to the new one, a list its `key` tells apart changed row by row, rather than as the whole value (18.41). A `memo` takes a `store` (one per args, `store: ({ id }) => store.sqlite(db, \`feed:${id}\`)`), so an entry opens on what was kept without running its function, and keeps what it produces and what its owner writes (11.78). A `job` takes a `store` for its status in place of `lastRun`: a restart reads when the last run ended, sends a missed time once, keeps the last result, and reads no run as going (54.17, 54.42).
- ea4380f: A served memo entry kept in `store.sqlite` or `store.redis` keeps its changes in the store's log: each change is a record — the JSON Patch it wrote, or the value whole every 64 records — and its version is that record's number. A restarted server opens the entry on the log and stands at the same version, so a page reconnecting after a deploy is sent only the patches it missed, not the value; and a second server process sharing the file hears the other's records and sends them on to its own followers, at the same versions (18.42-18.45).
  
  A version is named without waiting on the log: the process takes the number after the last it knows, answers followers from memory, and writes the record behind it with the new `LogStore.appendAt`, which appends only where that number is still free — a Lua script in Redis, a transaction in SQLite and IndexedDB (18.46). Two processes that change the value at the same moment meet as a conflict: the one that lost applies the other's records, puts its own change on top, writes the result whole, and sends a follower holding a number it gave up the value (18.47). Once an entry is opened on its log, the store's watch no longer re-reads the value, because the log is how another process's change arrives.
  
  **Breaking for a hand-written `LogStore`:** it must implement `appendAt(entry, expected, at)`, answering the new number, or `undefined` where the last number is no longer `expected`.
- 61de63c: report takes a failure, and the draft holds the trace the answer carrying that refusal named, kept beside the refusal as its Retry-After is — no onRefusal map of the app's own — 48.1
- 7e2455c: `fetchData` is `fetchAndHandle`, and it is isomorphic: imported from `@abide/abide`, it runs in the browser as well as on the server (`@abide/abide/server` still re-exports it). `handle` is no longer exported — `fetchAndHandle` reads the body as `handle` did. Its `ttl` cache is gone: hold an answer in a `memo` over the call, `memo(({ id }) => fetchAndHandle(url(id)), { ttl: 60_000, global: true })`, keyed by what you ask with, or give a handler its own `ttl`. `abide upgrade` renames `fetchData` (38.225); a `ttl` handed to it, and a `handle(response)`, are left for you to move.
- 62f1d9e: `fetchAndHandle` rejects with its `FetchFailed` rather than resolving to it, as a handler's call, a pipe call and `Job.run` do: `await fetchAndHandle(url)` hands back the body alone, and a `catch` narrows what it caught with `fetchAndHandle.isError(error, 'FetchFailed')`, as `rpc.isError` narrows a handler's refusal (54.40). A handler that lets it reject refuses with it (54.12).
- ae681d2: format.date and format.dateParts take Intl.DateTimeFormat's own options beside style — `{ style: 'dateTime', weekday: 'short' }` — and format.number writes a value in the unit it is handed — 52.112, 52.114, 52.115
- 30d2a5a: A handler whose body answers a `Reactive` — `GET(() => liveValue)` — now throws on the run that answers it, as `GET(liveValue)` already threw where it was declared (16.109): the server serves a function or a `memo`. Serve the value as a memo (`GET(memo(fn, { global: true, ttl }))`), and read whether it is loading with `busy({ tags })`.
- dd8a03d: A handler's body is kept per set of args whatever it declares: one declaring no parameter is kept on `undefined`, and its parameters are never read to decide. A body no longer runs again when a value it read changes; a handler serving a live derived value is `GET(computed(() => …))` (16.6).
- 43a3efb: a `job` can run on the times a cron expression names: `job({ cron: '0 8 * * 1-5', timeZone: 'America/New_York', run })`, given in place of `every` — one or the other, a `TypeError` otherwise — read by `Bun.cron.parse`, waiting for its first time rather than running as the app opens, and running once for every time a restart missed (54.36, 54.37, 54.38)
- 8b7d097: `job` takes `delay`: the first look waits that many milliseconds after the app opens rather than looking at once, and the schedule runs from there (54.44).
- 99a38ba: a `job` is handed its options alone, its name among them and now optional — `job({ name: 'digest', every, run })`, typed as the exported `JobOptions<Input>`, a failed run logged under `job` and that name where it is given — and what runs it ahead of its schedule is `Job.run`, where it was `runNow`; `abide upgrade --from 0.143.0` moves the name into the options and renames `runNow` (38.219)
- 8b296a8: Breaking: a job's run is handed what runNow was called with rather than a signal — job({ run: (signal) => … }) becomes job({ run: (input) => … }) with abortSignal() read in the run for its signal, runNow(input?) hands its input on, a run the schedule starts is handed undefined, and a runNow that joins a run in flight leaves its input unread; job and Job take the input's type as Input — 54.16, 54.22, 54.35
- 1c951c1: Calling a ledger reads it: `calls()` / `calls(after)` / `calls({ cursor: 'scorer' })` answers the stream `calls.read(...)` did, and `read` is gone. A ledger is no longer a `Reactive` of its entries — it holds no copy of what its store keeps and asks the store nothing until it is appended to or read (58.8), so one only appended to and read by a cursor costs no memory for its log. A page that wants the entries as a value hands the read to a body: `memo(() => calls())`, `global` where many readers share one read. Serve it across the wire as a streaming `GET` that yields `calls(after)`. Its docs page moves to Orchestration, beside `pipe`.
- 19deb43: Breaking: `lightbox`'s carousel is `carousel` — its `host`, `item`, `previous`, `next`, `play`, `playing`, `current`, `selected`, `scrollTo`, `reset` and `id` handed back whole under its name rather than laid flat beside the dialog's parts (49.18, 50.65) — and `playback`'s `speed` is `toggleGroup` (49.18, 51.134). `abide upgrade --from 0.143.0` moves both where the name is bound to a `lightbox` or `playback` call (38.221).
- 1b96f1c: A `memo` and a handler are one keyed mechanism: `GET(fn, options)` serves `memo(fn, options)` at an address, and `GET(m)` serves the memo `m`. A `memo` call answers a promise of its value for those args — even for a function that answers one synchronously — or the stream of its chunks, and a `reactive.derived` handing it back whole holds the live value. Its owner writes and follows a key directly: `m.set(args, value)`, `m.patch(args, mutate)` and `m.readable(args)` — and so does a handler's, past every rung: `feed.patch({ account }, (entries) => entries.push(row))` reaches every page following that account's feed. `memo` takes `poll` and `key` beside `ttl`, `tags`, `global` and `args` (11.2, 11.76, 11.77).
- 3cfb0a4: `memo` and handlers take `throttle` and `debounce`: a key reached anew is held back as before (5.18), and each entry is paced too, its owner's `set` and `patch` included, so every follower is sent at most one value per window and always the last (5.24). Pacing is the source's — the copies every follower is sent — which a reader's own pacing could not hold back (16.110).
- ba66bc6: `memo(fn)` is now `fn`, remembered: a call answers what `fn` answered for those args — a value, a promise or a refusal, handed back as it was rather than as a `Reactive` — and runs `fn` only for args it has no answer for. A `reactive.derived` that calls it holds the answer as a value and runs again when that key is refreshed or invalidated (`m.refresh(pattern)`, `m.invalidate(pattern)`). A function answering an async iterable — an async generator — is run once per set of args, and every call reads that one run from its start through a cursor of its own. A keyed value the server patches is `memo((args) => reactive(…))`. `memo` takes `ttl`, `tags`, `global` and `args`; a value's own options (`poll`, `store`, `key`, `schema`) go on the `reactive.derived` or `reactive` it answers. A `GET` over a keyed body takes the body and its options directly: `GET((args) => …, { global: true, ttl })`.
- d1472ab: `menu` opens submenus: a menu whose trigger is another menu's item is its submenu, a pick in it closing every menu. A menu given `side: 'right'` or `'left'` opens on the arrow toward that side and closes on the arrow back, so a vertical `toolbar({ role: 'menubar' })` opens its menus to the right.
- e28cbe7: Breaking: a `pipe` called is an async function: it resolves to its item's answer, or to the refusal a step answered, as `fetchData` does, rather than answering a `Reactive`. Hold its answer as a value with `memo(() => thumbs(file))` — the memo's run aborts the item it replaces, and a refusal is its error. RULEBOOK 57.5 amended.
- 6d4d1e4: `pipe`'s `key` option is now `group`: `pipe(steps, { group: (contact) => contact.id, concurrency: 1 })` runs one item per group at a time, as a FIFO queue's message group does. `key` now means one thing across abide — what tells one element of a value from another.
- 62f1d9e: A pipe call and `Job.run` reject with a refusal, as a handler's call does: `await rename('d2')` hands back the last step's answer, and a step's refusal — returned, or rejected by a handler called as a step — ends the item and rejects the call, still read for transience and retried where it is worth asking again (57.5). `Job.run` rejects with what its run threw or refused; the status keeps `lastError`, and a run its schedule started is logged as before (54.39). A pipe's `readable` still hands a refused item on as its refusal.
- 8b52631: an anchored layer with no room on its side or the opposite one takes the side of the other axis with room, and where no side has room, the one with the most — popover, menu, tooltip and combobox alike, with no new option — 50.19, 50.20
- 45cce58: popover opens on a mouse or pen resting (`openOnHover`), on focus the browser shows (`openOnFocus`), and closes what a pointer opened on a leave (`closeOnLeave`) and what focus opened on a blur; menu takes the three as the popover options they are, and tooltip.tip opens and closes by the same mechanism — a focus-opened hint now stays for a mouse leave, and a touch no longer opens one — 50.24, 50.25, 50.28, 50.55, 50.56, 50.75, 50.76
- 7a38a28: Breaking: `refuse.named` takes its name and one options object — `refuse.named('DealClosed', { status: 409, message, schema })` — where it took the status, the message and the schema as arguments after the name. The status is optional and still defaults to 400. `abide upgrade` moves each call (38.222).
- 85c7a6c: a FetchFailed for a status outside 2xx, from fetchData or handle, keeps what the service answered as its cause, read as its type says, up to 65,536 bytes, and Problem Details still carries none of it — 54.27, 54.30
- 7ec6576: Calling a handler answers what its body answers: a promise of the value that rejects with the refusal — so `await save(args)` hands back the value, and a `try`/`catch` with `save.isError(error, 'Name')` handles a refusal — or, where the body is an async generator, an async iterable of its chunks. Only `reactive` and `reactive.derived` hand back a `Reactive` now. A page reads a call as a value with `const deal = computed(() => getDeal({ id }))`: a `reactive.derived` handing a call's answer back whole adopts the handler's value, so it follows the server, takes its patches, holds an `offline` stand-in, and is busy, ready and refused exactly as the call used to be; `saving.set(save(args))` adopts it the same way. A call awaited inside a `reactive.derived` subscribes it to that value. Where a page wrote `const deal = getDeal({ id })`, write `reactive.derived(() => getDeal({ id }))` (1.1, 16.3, 16.107, 16.108).
- e7e0b14: BREAKING: `rpc` over a `memo` or a plain value answers `GET` alone. Its writes — a value's `set` and `patch`, a memo's `set`, `patch` and `refresh` — are answered only where `methods` names their verbs: `rpc(board, { methods: ['GET', 'PATCH'] })` takes a browser's `patch`, and anything else is 405. A memo is a computation of the server's data and an exported value is usually configuration, so neither is writable by any caller unless it says so. A bare memo or value in a `<script server>` is read-only the same way; move one that is written to a server file beside the component and name its verbs there. An `rpc`'s type carries `set`, `patch`, `delete`, `run`, `push` and `append` only where it answers their verbs, so a write the server would refuse does not type-check (16.111, 16.112, 16.117).
- f987fc7: `rpc` over a `table`, a `job`, a `pipe` or a `ledger` answers its whole face: its read by `GET`, and each write by its own verb — a table's `set`, `patch` and `delete`, a job's `run`, a pipe's `push`, a ledger's `append` — in process on the server and sent from a browser's copy (16.117). `rpc` over a `memo` answers its read, and its `set`, `patch` and `refresh` where `methods` names `PUT`, `PATCH` and `POST` (16.111). `columns` narrows what a table's `rpc` reads and writes (16.118). A `table` is written by key with `set`, `patch` and `delete`, refreshing its tag at once (47.33, 47.34). Every `.server.ts` exporting an `rpc` answers at its own path, a `lib` directory's among them, and one exporting none is a module (16.2, 16.73). A browser import of a server file's export that is no `rpc` is refused in abide's words (16.29).
- 5004b95: rpc.tool, the name MCP and OpenAPI list a handler by, read off its route with the mount taken off so it is the same under a sub-path, and what resultsOf matches a call by — 20.24
- 514bb7c: `rpc` replaces `GET`, `POST`, `PUT`, `PATCH` and `DELETE`: one name, its verbs read off the value — a function and a value are read by `GET`, and a value named `PUT` and `PATCH` in `methods` is changed by them too (the server's one value, a browser's `set` and `patch` sent to it) — or named by `methods` (16.111-16.116). A handler file is a server file: `<name>.server.ts` directly in an address directory answers its default `rpc` at its route and each named `rpc` below it, or wherever `address` says, and server code imports the same callable the browser does (16.2, 16.73, 16.74, 16.113). A `GET` whose args outgrow its URL is sent as `QUERY` (16.114). A `<script server>` exports the values its component calls in place of declaring private handlers (16.70, 34.17). `abide upgrade --from 0.144.0` moves an app over (38.231).
- 62ce831: A `<script server>` exports bare values: each is its component's private handler, at the verbs its value answers by — a function's, a value's and a memo's `GET`, a table's, a job's, a pipe's and a ledger's writes beside it (16.70, 16.111, 16.117). Importing `rpc` there is a compile error, and `rpc` over a value that is an `rpc` already is refused (16.119): anything taking options — `methods`, `address`, `middleware` — is a server file's `rpc`. `abide upgrade --from 0.144.0` exports an option-less `rpc` in a server block as its value, and notes each one that takes options (38.231).
- c0859ff: The server owns no `Reactive`: a handler declared over one throws at construction (16.109). A value the server writes is a handler's own — `GET(() => initial, { global: true })` written with `handler.set(args?, value)` and `handler.patch(args?, mutate)`, which every page following those args is sent — and a following browser's subscription builds the entry for its args where nothing has answered them yet (18.40). In a browser, `handler.patch` writes this page's copy, as an `offline` stand-in does. `job.status` and `pipe.status` are memos — `await digest.status()`, or `reactive.derived(() => digest.status())` on a page — and a job's status now carries `lastTook` and `lastResult`, the last good run's answer (54.41).
- cf0121b: `reactive.share(key, create)` is `reactive.shared(create)`, a handle declared once — usually at module level, `export const cart = reactive.shared(() => [] as Line[])` — and called where the value is wanted: `cart()` hands back the value the nearest component above holding one holds, or one created in the calling component (10.1-10.7). `create` answers the opening value, held in a `reactive`, or a `Reactive` handed back as it is. Handles are told apart by identity, so string keys, their literal-key build check and the declaration-merged `Shared` interface are gone; `Shared<Value>` is now the handle's type. `abide upgrade` turns a key one file uses alone into a handle declared at that file's module level, and notes every call of a key several files share, which should all import one exported handle (38.229).
- ce54ca6: sortableList takes a `group`: lists sharing one take each other's items by a grip dragged onto the other list or by Alt with ArrowLeft and ArrowRight, each list's `order` written on the move, the selection going with them and the list entered named in the announcement — 51.178-51.183
- bfcf7ac: `reactive` and `computed` take a value's options alone — `schema`, `transform`, `identity`, `key` and `store` — and throw at construction on `ttl`, `throttle`, `debounce`, `tags` or `global`, which a `memo` or a handler declares and a `computed` reads (11.81). `poll` is gone everywhere: a `memo`'s `ttl` takes its place, refreshing an entry something reads once its life runs out — counted from when its last value landed — and letting go of one nothing reads (6.1-6.5). Work that must run whether or not anything reads it is a `job` writing the memo, and `App.stop` waits on a job's run in flight (54.43). `abide upgrade` rewrites a memo's or handler's `poll` as a `ttl` and notes each, along with every `reactive` or `computed` handed a source's option (38.227).
- a5e67c6: A `table` call matches by JSON: a value, `null`, an array of values it is one of, or `{ gt, gte, lt, lte, ne }` comparisons met together (47.36). `sql` binds an array interpolated as `IN ${ids}`, an empty one matching nothing (47.37). A read-only database is still read by a `table` call and by `sql`, its stopped watch said once (47.38).
- 924ef16: An opener's `sql` runs a statement as a tag — every value bound, one statement per call site — and answers its rows (47.32). A `table` is callable: `deals()` is every row and `deals({ stage: 'won' })` the rows matching (47.35). What reads a table declares its name among its `tags`, and is refreshed when the table changes (47.29).
- b365c78: **Status belongs to Reactives only.** A handler (`GET`, `POST`, …) no longer has `busy()`, `ready()` or `synced()`, and the free `busy`, `ready`, `synced`, `refresh` and `invalidate` take one `Reactive`, `{ tags }`, or nothing — not a handler, and no pattern (13.1). A handler's call answers a promise, so to show its loading state read it inside a `reactive.derived` and ask that: `const won = computed(() => getStage({ stage: 'won' }))`, then `won.busy()`. A handler and a memo keep `refresh(pattern?)` and `invalidate(pattern?)` as methods: `refresh(getStage, { stage: 'won' })` is now `getStage.refresh({ stage: 'won' })`. A bare `busy()` is still true while the outbox sends a queued call (46.11), and `outbox(handler, pattern?)` takes a handler.
  
  **A memo takes `schema`, `transform` and `identity`**, as `reactive` does (11.79), so `GET(fn, options)` and `GET(memo(fn, options))` take the same value options. A handler's `store` is typed as a memo's is, so `store.sqlite(db, 'calls')` and `store: ({ account }) => …` no longer need a type argument naming the value.
  
  `Rpc.keyed` is removed.
- 0a4cfc9: A `memo` body that hands back any async iterable streams — a `ReadableStream` as well as an async generator — so `memo(() => log.read())` holds the entries a stream hands on. A run superseded cancels the stream it was reading at once, even while it waits on its next chunk. A `Reactive` handed back is still adopted, never streamed — 9.6
- 74dd3fb: A handler's `timeout` (and `ABIDE_RPC_TIMEOUT`) now bounds its answer, or a stream's FIRST chunk — a stream that has begun keeps its own pace, so a live feed waiting on its next event (a chat, a ticker, a ledger's tail) is no longer ended with a 504 for going quiet — 16.59
- eb964b4: `toolbar` is new: WAI-ARIA's toolbar as parts, controls sharing one tab stop the arrow keys move along, and given `role: 'menubar'` its menubar, the menus it holds switching between each other as their `group`.
  
  Breaking: `slider` picks one value by default, its `thumb` and `input` among its parts. A two-thumb range now takes `range: true`, its ends still `end(0)` and `end(1)`.
- 7b96aba: `abide upgrade --from 0.143.0` renames the parts 49.18 now names for their component — `talk.jump` to `talk.autoscroll.jump`, `steps.progress` to `steps.meter`, `crumbs.overflow` to `crumbs.menu`, `replay.speed` to `replay.toggleGroup`, `viewer.next` and every other member a lightbox laid flat from its carousel to `viewer.carousel.next` — where the name is bound to a `chat`, `wizard`, `breadcrumbs`, `playback` or `lightbox` call in the same file, leaving the same member read off anything else (38.221). What it cannot move by rote is left to the checker: `talk.draft` written or read as a string (it is a message now), the `{...talk.dropzone.host}` and `{...talk.autoscroll.host}` spreads a composer and a transcript now need, a job's `run` that read its argument as a signal (it reads `abortSignal()`), and a chart's `x` handed an index where its `x` option holds values.
- aa07055: `abide upgrade` keeps an `isFailed` check on a `fetchData` answer firing: where the answer is a name the file hands `isFailed`, the renamed `fetchAndHandle` call catches its `FetchFailed` back into the answer, as `fetchData` resolved with it (38.225). What a migration changes the meaning of and cannot rewrite — a `ttl` the call no longer takes, a call in a file that checks a failure whose answer it cannot follow — is printed after the diffs as its path and line, with what to do there (38.226).
- b67e310: A `memo`'s `throttle` or `debounce` window starts the first key it reaches at once, as a debounced value let its first value through: a debounced search opens on its first answer, and a server render no longer goes out without it. Each key reached after that is held back as before (5.18).
- e50b9e5: Breaking: `wizard`'s `progress` is `meter` — a `meter`'s parts handed back whole on elements of their own are a member named for the `meter` (49.18, 51.144).
- a3d9ca4: `m.set(value)` and `m.patch(mutate)` without args now type-check only on a memo (or handler) that takes no args at all. Where its args are optional, a lone argument could be the args or the value, so name the entry: `m.set(undefined, value)` or `m.set({ page: 2 }, value)` (11.80).

### Patch Changes

- ceaf52c: The 11.30 warning reads abide's `jsonSchema` by symbol, as the build does: `import { jsonSchema as js }` is still read for its defaults, and an app's own function named `jsonSchema` no longer is.
- a8ce49b: one walk for a call's top-level commas, argumentCommas in tokenize ([`0d482ca`](https://github.com/briancray/abide/commit/0d482ca777ed65762bdda5e3755aeda5492298da))
- a8ce49b: a function declaring no parameter is keyed on undefined already — drop the (_none: undefined) spelling (11.2) ([`166e2a6`](https://github.com/briancray/abide/commit/166e2a6721df55a0f3994bdd042ee35306d9785b))
- a8ce49b: one per-source migration loop, a lane field for counted aborts, holdsUndefined reused, TypeSession.inspect removed ([`225f8f8`](https://github.com/briancray/abide/commit/225f8f8edfbe1e98d8cc8c11a2b2ee7cfb107cc0))
- a8ce49b: stage 2 — table and tag tests over the new face; a write's face takes no derived args ([`2c903ce`](https://github.com/briancray/abide/commit/2c903cee295e2a5751f0594d95f8eaa587aab363))
- a8ce49b: format sections.ts and NotePreview.test.ts ([`2ff590a`](https://github.com/briancray/abide/commit/2ff590a31962d0b2ee38536b5fe0e30cdfdef56f))
- a8ce49b: stage 2 — sources answer their face through rpc, in process and from the browser ([`3a21da2`](https://github.com/briancray/abide/commit/3a21da269c51dd23150ba063dbe52ad51b0cb9c2))
- a8ce49b: gates for the verbs, QUERY, a value's writes, server-file addresses and the migration — 16.111-16.116, 38.231 ([`3b98567`](https://github.com/briancray/abide/commit/3b9856725311617687b769d6a377888aa4fd6514))
- a8ce49b: a computed adopting a call lets go of the read the call made, so a refusal does not restart the load; the CRM feed handler stays global (16.107, 18.5) ([`4188712`](https://github.com/briancray/abide/commit/4188712ec8f8e5a408ef83eea530a8528121ff51))
- a8ce49b: stage 1 in progress ([`4276283`](https://github.com/briancray/abide/commit/42762830cd82bd81eac280aabca9add2a2997ddb))
- a8ce49b: one SQL identifier leaf, stores import Store by module, server-only header leaves under server, isJsonEssence, ReportContext ([`456bfb3`](https://github.com/briancray/abide/commit/456bfb351c40c975099d1384c9b4e063e384533d))
- a8ce49b: args its gate refuses throw the refusal, as a call rejects with it (11.27) ([`4ef8574`](https://github.com/briancray/abide/commit/4ef8574ec85b79b837896f62b08dd4003c762f0a))
- a8ce49b: Breaking: the move to rpc leaves a GET over a memo or a plain value bare, as rpc answers it GET alone; 16.111, 16.112, 16.117, 38.231 amended ([`6213003`](https://github.com/briancray/abide/commit/6213003e7b9e54d878ee98e9ea65d80e9388a997))
- a8ce49b: a table's upserts prepare one statement per row shape ([`6277720`](https://github.com/briancray/abide/commit/627772096d1ef356adcfe4185780d1c9448e69b4))
- a8ce49b: appFiles no longer lists 23.17 among the refusals it makes — appLayout's refuseFrameworkRoute does ([`6d9ac92`](https://github.com/briancray/abide/commit/6d9ac92a7ed366fb1e08ae70b1105d2da6831b21))
- a8ce49b: a replaced value is sent as the diff from the one it replaced (18.41); tests to follow ([`70c71fb`](https://github.com/briancray/abide/commit/70c71fbefb8883d1ff91f4b034da87e5987b1980))
- a8ce49b: BridgeReport says why it is loose — a posted line cast from JSON, not the bridge's TurnReport ([`7e6af7f`](https://github.com/briancray/abide/commit/7e6af7fceef9195075b7acd9098d4421b838f136))
- a8ce49b: the 38.220 chart migration is a row of toNamedParts ([`7e7552e`](https://github.com/briancray/abide/commit/7e7552e2eaa46aad25b15bb3e02d79ae80b171c2))
- a8ce49b: a server file exporting no rpc is a module; a whole-app refusal is read off 16.67; a promised value takes no source's options ([`7fb90a1`](https://github.com/briancray/abide/commit/7fb90a1a7143e2de0a5fc2433fec1e310448ca53))
- a8ce49b: bindSpread asks isControl, read off the one 32.113 list isControlProperty reads ([`84974ed`](https://github.com/briancray/abide/commit/84974ed4a690f7dd3e3a4cb782ebb1429fcf8827))
- a8ce49b: a call answers what its body answers — a promise rejected with its refusal, or a stream; a computed or a set handed one adopts the handler's value (16.3) ([`84b9c56`](https://github.com/briancray/abide/commit/84b9c56bd2ad71153bda8a8c71afc74469c39bc6))
- a8ce49b: the leaf modules say what they buy — no core load for one symbol, not client bytes ([`86758a9`](https://github.com/briancray/abide/commit/86758a97c95cd6a71a3b3542f1730a291a2f1d40))
- a8ce49b: drawnDown says why it is not shrinkImage — 44.53's WebP is kept where it fits, drawn as PNG where it does not ([`88a656f`](https://github.com/briancray/abide/commit/88a656fcd947b48a11332bd971d8789882733d5a))
- a8ce49b: the shell head is cached per document, not one at a time ([`9beb02c`](https://github.com/briancray/abide/commit/9beb02c33f778f52edf4c8d7d6adc836fd1a2214))
- a8ce49b: a <script server> exports bare values — rpc there refused at build and over an rpc at run; 38.231 exports bare ([`b2b076f`](https://github.com/briancray/abide/commit/b2b076f847cde8900de62d3434390cf8f51efc33))
- a8ce49b: what round 1 surfaced — the 23.17 refusal lives in appLayout, two namesAbide pass-throughs gone, clamp's text leans on the region it merges, a moved test's docs path ([`b5011aa`](https://github.com/briancray/abide/commit/b5011aa7abb93d8d19f489ea8d9be83dc3e8ce5a))
- a8ce49b: one abort-aware sleep for a retry's wait, pipe's and fetchData's ([`b93b6ef`](https://github.com/briancray/abide/commit/b93b6ef9c95c09587a3a3bf1fa10a7dc9f4c3d7c))
- a8ce49b: refuse.named's optional status and message take undefined — the same default as absent, so an app under exactOptionalPropertyTypes hands on a message it may not have ([`bce4255`](https://github.com/briancray/abide/commit/bce4255d90e63ae7a8405ff81f1d7d994721cd35))
- a8ce49b: declaresParameter goes with the sniffing it served; CallAnswer is exported beside Rpc ([`bdec6cf`](https://github.com/briancray/abide/commit/bdec6cf6a603154372ee6299fecb6558929a008f))
- a8ce49b: a server block's export is the rpc over its value where declared; fixtures and docs examples export bare or move writes to a server file ([`c098323`](https://github.com/briancray/abide/commit/c098323506d12996829a72dae0bc30f199904476))
- a8ce49b: stage 2 — sql reads track nothing; a table writes by key; sources carry their kind ([`c7cf647`](https://github.com/briancray/abide/commit/c7cf6476d32799fd97f2b11dbce0158923e9eba3))
- a8ce49b: 44.38's whitespace-alone rule is isSendable, read by chat and the server's blocksOf ([`cd48524`](https://github.com/briancray/abide/commit/cd485243310d7ccc275bb6c2122cb383fe1cc936))
- a8ce49b: one rpc page in place of GET and POST, its verbs, a value's writes, server-file exports, address and QUERY ([`d51f7ef`](https://github.com/briancray/abide/commit/d51f7efcc0c14f0f2c3435e2d791ad00de27e104))
- a8ce49b: a radio toggleGroup's tab stop is a memo, read by every radio once per pick ([`d5bd6f2`](https://github.com/briancray/abide/commit/d5bd6f2920cf7fc9297ea2a6498a8539868bb446))
- a8ce49b: ambientReadsIn names its own modules as the checker does — AMBIENT_SOURCES goes private ([`d5bee18`](https://github.com/briancray/abide/commit/d5bee181d0143a1f8fef476731d208140491c5e2))
- a8ce49b: CALL_ENTRY's optional member takes undefined (59.2) ([`f36daa9`](https://github.com/briancray/abide/commit/f36daa9c36cd195a51152d8b57173df6b78340f4))
- a8ce49b: a browser import of a server file's export that is no rpc is refused in abide's words — 16.29 ([`f6ba01a`](https://github.com/briancray/abide/commit/f6ba01a0185ba02314f9243d12097c4fe26b0d93))
- b974cca: A bare `class:` or `style:` — an ordinary attribute (32.10) — no longer keeps a spread on the same element from setting its `class` or `style` (32.11).
- f44a22f: `combobox`'s and `commandPalette`'s `listbox` carry `data-listbox="listbox"`, and `clamp`'s `text` carries `data-disclosure="region"` — the part each is built on, merged under its own (49.18).
- 2abdc93: A `chart` drawn with gridlines and no labels keeps no room for an axis: spread `tick.grid` and leave `tick.text` out, and the marks run edge to edge — no `yTicks: 0` needed for a chart with no axis (52.68).
- fc13560: chat's message part carries `data-ends` on the message that ends an answer, the state `ends` reads — 49.1, 53.29
- 5f6b3bc: a value, checked or selected written to a form control, named or spread, is kept in its property too, and a textarea's value is its text on the server — chat's composer clears after send, a stepper or a scrubber follows after it is typed in or dragged, and combobox, commandPalette, jsonInspector and inlineEdit no longer write the property themselves — 32.113, 32.114, 32.115
- 7f5f2be: a form control's value, checked or selected is written into its property only where it moved from what the binding last wrote, and not where the field's text reads as the number written — `value={n}` with `oninput={e => n = +e.target.value}` keeps the `1.` typed on the way to `1.5`, and inlineEdit's field opens again on the value after Escape — 32.113
- fae41a3: `for await` over a streaming `reactive.derived` or `memo` entry opened while a refresh's run is in flight walks that run, from its first chunk to its close, instead of the closed run a read still serves meanwhile (9.18).
- 0c1a8cb: a `YYYY-MM-DD` handed to format.date, format.dateParts, format.relative or time is the midnight of that day in the zone it is written in, not UTC's — the 18th no longer reads as the 17th west of Greenwich — 52.113
- 2235481: An entry a `memo`'s `throttle` or `debounce` window starts onto a call that is refused at once no longer stays busy: the busy was the window's and ends with the hold, so an `await` on it resolves to the refusal (5.20).
- e18bb81: download clicks its link in the document and keeps the address forty seconds rather than one turn, so a save WebKit decides on later — `abide native`'s included — still reads the file — 53.90
- 1d50d33: A `reactive.derived` that stops adopting a stream still running — its body hands back a plain value — now moves its probes, so an `await` taken while it streamed resolves to the value instead of hanging (2.7, 11.19).
- 187cb13: the tsconfig abide scaffold writes, and the default project an app with none is typed against, read every .ts as a module, so a script awaiting at its top with no import or export checks as Bun runs it — 38.218
- fe8d862: a `{#for}` subject ending on a member named by a keyword (`proposed.from`, `options?.default`) keeps its `key` apart rather than folding it into the subject, and `abide format` no longer refuses the head — 32.13, 38.126
- fc7c966: A `reactive.derived` re-pointed onto a key a `memo`'s `throttle` or `debounce` is holding back keeps serving what it served — busy, still ready — until the key starts, and clears for the run as before (5.25, 11.16). Search-as-you-type over a debounced memo no longer empties its list for the whole window.
- 985075e: A write a `throttle` or `debounce` window holds behind another no longer wakes the readers of `busy`: only the first write the window holds moves the probe, so a guard reading `busy` beside the value runs once per window rather than once per write (3.3, 5.15).
- a170a93: a job's run is its own owner: it runs outside the request that called Job.run and the look that started it, so abortSignal() in it — and a worker call or a pipe defaulting to it — no longer ends as the caller hangs up or the next look starts, and does end at Job.stop — 54.35
- 19a7b91: `onLauncher` answering a known option as `undefined` — `{ vibrancy: dark ? 'sidebar' : undefined }` — keeps that option's default rather than refusing the launcher and leaving the native app unopened (59.1). A key that is not a launcher option is still refused.
- ac7c1e7: `markdown.incremental` hands back a fenced block named in `blocks` even with no blank line around it: a code fence opening unindented is a section of its own, so a fence written straight under a line, or two fences back to back, are each a `block` rather than an empty code block inside a paragraph's section (52.43).
- 9e31c01: a member a read built is the value it holds: with `const glance = memo(() => ({ view }))`, `glance.view` lowers to `glance().view` rather than calling the value — 31.15
- 23d26ca: A `memo`'s call carries the refusals its function's answer carries, so `reactive.derived(() => m(args)).error()` over a memo of a handler is typed with the handler's refusals rather than as nothing (11.12).
- 01ae884: A `memo`'s and a handler's `store` takes a `Store<T>` typed by the value it keeps, beside an untyped one such as `store.sqlite(db, 'calls')`; a store of another value is refused (11.78, 16.110).
- cb043b6: A page, layout or error page a mounted package places under `/__abide` is refused at build, as the app's own is (23.17, 23.19) — before, only a mounted handler file was. An app's own `__abide` handler file is refused once rather than twice under `abide check`.
- 1d6e63c: Every option's type accepts `undefined`, so an app under `exactOptionalPropertyTypes` can hand on an option it may not have, and an option given `undefined` is read as one not given (59.1, 59.2). A `POST` given `ttl: undefined` keeps its `ttl` of 0, and a number formatter given an option as `undefined` keeps abide's default for it.
- 04e8e43: `disclosure`, `resizable`, `stepper` and `chart` check their parts while developing, as the other headless components do: an `aria-controls` or `aria-describedby` naming an element that is not there warns once on `abide:parts` (49.7). `accordion` and `clamp`, built on `disclosure`, check with it.
- 888742f: A `reactive.derived` that comes back to a `Reactive` it adopted before, holding the value the derived already serves — one a write made through the earlier adoption — no longer wakes its readers onto that same value (5.1).
- 283ed85: A refresh over tags marks every entry it reaches before it reloads any (13.7). A memo whose body awaits another memo under the same tag was reloaded first — it was reached first — and read what its source still held, so its followers heard each write one refresh late.
- 14815db: `abide upgrade`'s move to `rpc` (38.231) no longer widens an address: a `GET` over anything it cannot see is a function, a memo or a plain value — a table, a job, a pipe, a ledger, an imported name — keeps `methods: ['GET']`, where a bare `rpc` could also answer that value's writes (16.117). In a `<script server>`, such a `GET` is noted rather than exported bare, to be moved to a server file beside the component. `methods` is written into multi-line options on a line of its own, as a formatter would.
- c90af52: shrinkImage hands a picture back as it is only where it carries no EXIF, XMP, IPTC, comment or text metadata, and writes any other again without it — a small phone photo no longer keeps where it was taken — 53.89, 53.102
- 4da4c91: two `{...part}` spreads on components in one `{#if}` arm or `{#for}` row each name the region they stand at, rather than declaring one `const` twice and leaving a module that does not parse — 32.11
- af5eb07: `abide upgrade --from 0.142.0` renames `by` to `key` where 0.143.0 did — the `by` dividing a `{#for}` head and the `by` option written in place for `reactive` or `memo` — leaving a member, an item or a key named `by` as written (38.217); and a body renamed in a `{#for}` row's or an `{#if}` arm's own `<script>` is imported as `memo` in the page's script, which keeps `reactive` while any script still calls it (38.215)
- 56a5367: `abide upgrade`'s 38.215 migration adds `memo` to the import of abide's `reactive`, never to a `reactive` the file imports from a module of its own.
- 72e6c84: `abide upgrade` notes a `reactive` or `reactive.derived` whose options are handed by name or spread in, which it cannot read for an option 11.81 refuses (38.227), and each handler declared over a value the app declares as a `reactive` or `reactive.derived`, which now throws (16.109, 38.230).
- 5c08bf8: format.date, format.dateParts, format.relative and time read a date-time with no offset — `2026-11-18T15:04`, what format.date's 'input' style writes and a datetime-local field holds — as that wall clock in the zone they write in, rather than in the process's zone, so it no longer moves between the server and the browser; one with a `Z` or an offset is still the instant it names — 52.113
- Updated dependencies [a8ce49b]
  - @abide/bridge@0.9.1

## 0.143.0

### Minor Changes

- 310f3f8: Breaking: `stopSignal` is renamed `abortSignal`, and answers the innermost owner of the work it is called in. In a `memo` run it is still that run's own signal. On the server that now holds after the body's `await`s too, and a continuation of a run already replaced is handed a signal that is already aborted. Called in a request outside a run, it is the request's signal, which aborts when the caller hangs up. A run filed in a request aborts with that request. In a browser, read it before a body's first `await`; after one it is the app's (RULEBOOK 7.38, 7.39, 7.45-7.49). A worker thread and a `pipe` step now end on that same signal, so on a replaced run or a request whose caller left too (55.8, 57.13).
- ede8e57: `announce.host()` hands back the polite and the assertive live region as parts — `polite`, `assertive`, and `said(politeness)` for the message each holds — so an app can render the regions in markup of its own, as `toasts.host` and `prompts.host` already allow. `Announcer` is its default markup (RULEBOOK 50.51, 50.52).
- 5cbf4f7: `announce(text, { politeness })` has a screen reader read a message out with nothing shown, from an `Announcer` rendered once in the root layout (`import Announcer, { announce } from '@abide/abide/Announcer.abide'`): a polite and an assertive live region, standing empty from the first paint, each message replacing the last and the same words said twice read twice. A `Chart` announces its readout as the keyboard moves its crosshair (RULEBOOK 50.36, 50.49-50.52, 52.71).
- 9206ce8: An assistant's answer streams as the Messages API streams it, and a conversation is held as the API holds it. `assistant` yields each run of the model event for event — `message_start`, `content_block_start`, `content_block_delta` (`text_delta`, `input_json_delta`, `citations_delta`, …), `content_block_stop`, `message_delta` with its `stop_reason` and `usage`, `message_stop` — through `provider.claudeApi` and `provider.claudeCode` alike, and between runs a `tool_result` event for each call, with its value (RULEBOOK 44.2, 44.11, 44.28, 44.49). `assistantMessage('assistant', events)` makes the messages an answer amounts to, accumulated as the API's own clients accumulate its stream (44.105), and `chat` holds `messages` — the API's own — folding an answer into them as it streams (53.24-53.32, 53.47). `resultsOf` reads a handler's results off those messages (44.51). `ToolAnswer` takes MCP's `isError`.
  
  Migrating:
  
  - Events: `text` → `content_block_delta` with a `text_delta`; `tool` → `content_block_start` with a `tool_use` block; `input` → that block's `input_json_delta`s; `result` → `tool_result` (`content` is the blocks the model was shown); `done` → each run's `message_delta` (`stop_reason`, `usage`) and `message_stop`. A call reaches the handler its `tool_use` names; events no longer carry `handler`.
  - `transcript.turn` / `transcript.fold` / `transcript.messages`, `AssistantTurn` and `AssistantTurnPart` are gone: hold `AssistantMessage[]`, and turn a whole answer's events into messages with `assistantMessage('assistant', events)`.
  - `chat({ turns })` → `chat({ messages })`; `talk.turns` → `talk.messages`; `talk.turn(turn, index)` → `talk.message(message, index)`, rendering its `blocks` where it is `shown`; a tool part → a `tool_use` block, `talk.tool(block)` carrying its `toolResult` and `answer`; permission prompts → `talk.permissions`; an answer's failure and stop → `talk.failed` and `talk.stop_reason`, on the root as `data-failed` and `data-stop`. `data-chat="turn"` → `data-chat="message"`. Show Ask again under a message that `ends` its answer.
  - `resultsOf(events, handler)` → `resultsOf(assistantMessage('assistant', events), handler)`, or the messages a chat holds.
  - `ToolAnswer.failed` → `isError`.
  - A `Provider` an app wrote yields each run as the API streams it — `message_start` first — and a `tool_result` event between runs.
  - A stored conversation is the API's own messages; one stored as turns has no reader and is rewritten once.
  - Pair with a bridge of this release: an older bridge reports events in the old shapes.
- 87ba0f4: `assistant`'s `mcp` option is `tools`, naming what it does — the model is handed the app's tools — rather than the surface they are read from: `assistant(messages, provider, { mcp: true })` → `{ tools: true }`. `provider.claudeCode.bridgeCommand()` is removed: `provider.claudeCode.bridge()` already yields the command, the link and the install, so its first status is the one-off — `for await (const status of provider.claudeCode.bridge(options)) return status` (RULEBOOK 44.6, 44.8, 44.14)
- 4072564: `authorize` replaces `requireRole`: `authorize({ role: 'admin' })` or `authorize({ groups: ['sales'] })` admits one whose claims hold the ones named — an array holding every item listed, in any order beside others — and a function of the principal still works. `requireRole('admin')` becomes `authorize({ role: 'admin' })`. The default `Forbidden` message no longer names the role (RULEBOOK 54.2-54.4)
- edb7aae: attributes written onto a notice, and onclose told whether its timeout, a dismissal or its action took it — 50.35, 50.36 ([`01314e8`](https://github.com/briancray/abide/commit/01314e80e449a3c8311e10a09cb37bdb95645b9a))
- edb7aae: a signal withdraws a prompt, modal: false shows it beside the page, and run makes the confirm a call it stays up for — 50.1, 50.37-50.39 ([`101eefb`](https://github.com/briancray/abide/commit/101eefb7f8fbbaac0b3f459aff2943b7881e50d0))
- edb7aae: prevent: false runs a binding and leaves the key its default — 53.2 ([`2f5018e`](https://github.com/briancray/abide/commit/2f5018eacef47f39a87e216e3befa5f87e1d4d4a))
- edb7aae: Detail renders a row of its own under each row, spanning every column — 51.60 ([`333c24a`](https://github.com/briancray/abide/commit/333c24a8f1c08acf0fbfff6f1a3eb7a2fb25fce4))
- edb7aae: a poll does not refresh while the document is hidden, and refreshes once when it is shown again — 7.43, 7.44 ([`3f32700`](https://github.com/briancray/abide/commit/3f32700febf580ff4f07a22bee3a16b5a73c237c))
- edb7aae: a member a Reactive's own type adds reaches the Reactive — 31.5 ([`426321c`](https://github.com/briancray/abide/commit/426321c921965b4093675b1aa8c4909d6b6b5c8b))
- edb7aae: zero takes zero into the range, and a series of zeroes lies along the bottom — 52.32 ([`47da978`](https://github.com/briancray/abide/commit/47da978ca346ee43eef1f2215b4cee2479139b8f))
- edb7aae: a series of kind 'bar' draws bars from zero, onpick hears a click's nearest x, and disabled marks an x that takes no pick — 52.35-52.37 ([`659f554`](https://github.com/briancray/abide/commit/659f5547e5e8e5ffca6b658c9bfd55b5fe852702))
- edb7aae: instantAt reads a day and a time to the instant they name in a zone, and format.date's input style writes one back — 52.102-52.104 ([`b1169f5`](https://github.com/briancray/abide/commit/b1169f55e99677bec1b6542e34389100c3b46342))
- edb7aae: export followBottom, the bind:element adaptor Chat's transcript follows its bottom with, and the UpdateFeed type — 53.40, 53.44, 38.146 ([`c58a268`](https://github.com/briancray/abide/commit/c58a26852a6eb4f6c7ad66efca387c676b5d0e2a))
- edb7aae: Breaking: months shown side by side — calendar hands back months, each its grid, heading, label and weeks, one tab stop across them all — 52.97 ([`c70e5dd`](https://github.com/briancray/abide/commit/c70e5dd633f61af9817357c854f5867d00195194))
- edb7aae: a range picked across the months shown, with data-preview while it has no end, and active and idOf to put focus on the day — 52.98-52.101 ([`c7ee26d`](https://github.com/briancray/abide/commit/c7ee26d09f76efb96bef1b732a68404690d13342))
- edb7aae: Apple symbols for named keys, keyLabel.parts, an apple option, and a server with no request labels by its own platform — 53.3, 53.45-53.47 ([`ca85533`](https://github.com/briancray/abide/commit/ca85533f98bb38e5d79022c7d56ee18073dbef49))
- edb7aae: its key runs it in a browser page where no menu bar takes it, and on() filed in a setup is unfiled with it — 38.213, 38.214 ([`d167f03`](https://github.com/briancray/abide/commit/d167f03a269c50eaa01e154c462dbe235da72e83))
- edb7aae: a signed value's minus is −, an 'hour' style, and format.dateParts — 52.33, 52.34 ([`f636a18`](https://github.com/briancray/abide/commit/f636a188809128b252c4204cb13b86a37a6c7631))
- 6557691: Breaking: `followBottom` is renamed `autoscroll`, and is a headless component. `autoscroll(options?)` hands back `host` to spread on the scroller, `jump` to spread on a button that shows once the reader has scrolled up (with `data-unseen` once something arrived meanwhile) and takes them back down, `following` as a `Reactive`, and `toBottom()`. Options: `following`, `threshold` and `behavior`. `bind:element={followBottom}` becomes `{...follow.host}` from `const follow = autoscroll()`, and `data-follow-bottom` is `data-autoscroll`. `Chat` renders the jump button as its `jump` part (RULEBOOK 53.39, 53.50, 53.58-53.60).
- cc02f55: Every behavior abide applies to an element is a part you spread, not a function handed to `bind:element` (RULEBOOK 49.12). `tooltip.tip`, `dismissible`, `popover`, `copy`, `scrollEdges`, `observe.size`, `observe.visible` and `observe.rect` each hand back a part: write `{...copy()}` where you wrote `bind:element={copy()}`, `{...scrollEdges()}` where you wrote `bind:element={scrollEdges}`, and spread each one of a `bind:element={[a, b]}` list on its own. Several spread on one element, and a written `bind:element` beside them, are each handed the element in source order (32.99). A part also works on a component that spreads its rest onto its root, where `bind:element` is refused. What a behavior needs in the markup is now written by the server: `tooltip.tip`'s `aria-description` (50.23) and `popover`'s `popover="manual"` (50.48), with an attribute the element writes itself winning. Each part carries its `data-` name (49.3): `data-copy`, `data-dismissible`, `data-popover`, `data-scroll-edges`, `data-observe` (`host`) and `data-tooltip` (`anchor`).
- 6e882c5: `breadcrumbs({ trail, href, max })`, a trail of links to the page, the last carrying `aria-current="page"`. Past `max`, `items` keeps the first crumb and the last `max - 1` with an `overflow` between, and the overflow is a `menu`'s parts, the `folded` crumbs its items (51.136-51.140).
- 1f6eb03: `calendar({ month, selected, firstDay, locale, timeZone })` is WAI-ARIA's date grid as parts an app spreads onto markup of its own: the whole weeks a month falls in, a header cell per weekday named in the locale, a cell per day carrying `data-today`, `data-outside` and `data-selected`, the month's heading and the buttons paging it. Days are `YYYY-MM-DD` strings counted on UTC's calendar, so a daylight-saving change drops or repeats none and a server render matches the page it hydrates; a week starts on the locale's first day; the arrows, Home, End, Page Up and Page Down move through the days and the months (RULEBOOK 52.82-52.95).
- 4cb90fb: `carousel` and `lightbox` take `align` — `'start'`, `'center'` (the default) or `'end'`, as `scroll-snap-align` names them — and line an item's start, center or end up with the same point of the scroller, `scroll-padding` included (RULEBOOK 53.99). With `align: 'start'` and items a third and a bit of the scroller wide, three and a tenth show and `next` moves one. The item lined up is `current`, carrying `data-current`. `previous` and `next` pass over any item the scroller ends before it can align, and are disabled where only such items are left, so no press scrolls nowhere (53.67); and a scroll stopped at an end keeps `current` on the item it was (53.100).
- 8a7ba86: `carousel` and `lightbox` take `autoplay`, the milliseconds between steps, and `playing`; spread the new `play` part on a button to pause and play it. It steps as `next` does, stopping at the end unless it loops; a step by hand or a swipe starts the count again. It holds still while the pointer is over, or focus is inside, the scroller or its buttons, only turns while the scroller has a box (so a closed lightbox never does), writes `false` to `playing` for a reader who prefers reduced motion, and carries `aria-live="off"` while it turns (RULEBOOK 53.71-53.78). The clauses after them move up eight: `copy` through `panZoom` are now 53.79-53.98.
- 567b515: `carousel` and `lightbox` take `loop`: where it holds, `next` at the last item goes to the first and `previous` at the first to the last, and neither is disabled — so a lightbox's arrow keys go round too. One item still steps nowhere (RULEBOOK 53.67).
- e511639: `carousel(options)` is a scroll-snap carousel as parts — `host`, `item(item)`, `previous` and `next` — that rests on the item `selected` names, follows the item a scroll aligns as `current`, and scrolls with `scrollTo(key)` and back with `reset()`. Where the browser reports `scrollsnapchanging` and `scrollsnapchange` they set `current`, and where it does not a scroll is measured once a frame (RULEBOOK 53.61-53.70).
- 3613676: A `Line` or an `Area` declaring `curve` is drawn as a curve through its values, and so is a `Sparkline`'s line and area — a monotone cubic that passes through every point and never swings past the two values it joins, a stacked area closing along the curve of the one under it. `chart.path`'s third argument is now an options object, `{ baseline, curve }` — `chart.path(xs, ys, 50)` is `chart.path(xs, ys, { baseline: 50 })` — and a series handed to `chart` takes `curve: true` (RULEBOOK 52.104, 52.105).
- 25a1bed: `chart`, `pie` and `sparkline` hand a chart back as parts: its geometry as data — ticks, marks, bars, points, the crosshair and its readout, and `x`, `y` and `frame` for a drawing — with a part to spread on each SVG element, so `{#for point of plot.points()}<circle {...point.circle} r="3" />` marks every value. `Chart`, `Pie` and `Sparkline` are now default markup over them. `chart` is callable, and keeps `chart.ticks`, `chart.scale`, `chart.path`, `chart.stack` and `chart.nearest` as its members (RULEBOOK 52.78-52.81).
- 5fef691: `Chart` replaces `LineChart`: its `Line`, `Column` and `Area` children declare the series it draws over one pair of axes, `stack` and `normalize` pile them into stacks or shares, a child's `stack` names its stack or keeps it out of one, and `bounds` fixes an axis's range. The y labels stand in a gutter left of the plot, so no mark is drawn over one. The readout opens in the page's `Tooltips` and describes the chart; the chart takes focus, the arrows and Home and End move its crosshair, Enter picks the x it stands at, and Escape puts it away. `Pie` draws shares of a whole as a pie or a donut. `chart.stack` is the stacking arithmetic, `chart.path` closes an area onto a baseline of one point per x (RULEBOOK 52.24-52.30, 52.37-52.39, 52.51-52.70, 50.46). Migrate `<LineChart series={[{ label, values, kind: 'bar' }]} />` to `<Chart><Column label={label} values={values} /></Chart>`, and render a `<Tooltips />` for the readout.
- ab3f197: `Chat` takes `Tool`, rendering a tool call in place of its name, input and result; `Actions`, rendered under each answer with a `retry` that asks the question again; and `turns`, bound to load and keep a conversation. `Text` is handed the part and its turn beside the text, and a question sent while an answer streams is queued, with a Cancel, and asked once it ends (RULEBOOK 53.34, 53.46-53.47)
- 910a6d3: `Combobox` bound to an array picks several items: a pick adds an item or takes it out again with the list left open, each item picked is a chip with a remove button (or a `Chip` component), and Backspace in the empty input takes out the last (RULEBOOK 51.55, 51.56)
- c0dd8b3: `combobox` is the field that lists what matches as parts an app spreads onto an input, a popup and options of its own, with its own option and chip markup: the combobox role and states, the keys, the search, the pick and the top-layer popup. `Combobox` is now default markup over those parts and behaves as before (RULEBOOK 51.13-51.33, 51.55, 51.56, 51.57).
- cb1eaf1: `combobox` no longer hands back `picks` or `unpick`: where it picks many, its `value` is already every item picked, and `chip(item).remove` is the button taking one out — iterate `box.value` for the chips
- 3db2c75: `commandPalette(options)` is the command palette as parts an app spreads onto its own `Dialog` and list — `dialog`, `input`, `listbox`, `option(command)`, `empty`, `results()` and `open` — listening for its `hotkey` on the window itself, and `CommandPalette` is now default markup over those parts, behaving as it did (RULEBOOK 51.65-51.71).
- d0cb7e5: `CommandPalette` is a modal search over what an app can do: it opens on a key (`mod+k` by default) or a bound `open`, lists the commands whose label or keywords hold every word typed, moves with the arrows, runs a command on Enter or a click once it has shut, and leaves Escape to its dialog, which hands focus back (RULEBOOK 51.65-51.71).
- e39248f: `copy` takes one options object, and what it copies is its `value` option. With no `value`, a click copies the element clicked as one clipboard item: its `textContent` as `text/plain` and its `innerHTML` as `text/html` (RULEBOOK 53.79). Move the first argument into the object: `copy(text, { copiedFor })` is now `copy({ value: text, copiedFor })`.
- 8eb5b83: `copyText` is now `copy`. It takes a record of MIME type to what that type holds, beside a string, so one click copies `text/html` and `text/plain` together, or an `image/png` Blob, as one clipboard item (RULEBOOK 53.54). Where `navigator.clipboard` or `ClipboardItem` is missing or refuses, the selected-textarea fallback lays every string type on the `copy` event, and a value holding no string reports not copied (53.22, 53.55). Rename `copyText(…)` to `copy(…)`; a string copies as before.
- 813ce06: `copy` takes `selector`, so one binding on a container copies from the buttons inside it — the ones a `raw` block holds — and `oncopied`, called with whether the copy landed and the element clicked; a function given as the text is handed that element (RULEBOOK 53.43, 53.44)
- 5f1b95d: Breaking: `structural` is renamed `deepEqual`. `{ identity: structural }` becomes `{ identity: deepEqual }`; what it compares is unchanged — arrays and plain objects by contents, and "not equal" for anything else, a `Map`, a `Date` or a class instance (RULEBOOK 5.5).
- e37c765: `dialog(options)` is a native modal as a part spread onto a `<dialog>`: shown and closed by `open` both ways, Escape and the backdrop held back where it is not `dismissible`, `onclose` handed the `returnValue`. `Dialog` is default markup over it, and `commandPalette`'s `dialog` part is now `dialog`'s, spread onto a plain `<dialog>` rather than a `Dialog` (RULEBOOK 50.1-50.4, 51.65).
- e45a6db: `disclosure`, `accordion` and `clamp`, headless components for showing and hiding. `disclosure()` is a button and the region it shows, the region hidden `until-found` so find in page still reaches it and opens it (51.116-51.119). `accordion()` is a `disclosure` per key, one open at a time or, with `multiple: true`, any number (51.120, 51.121). `clamp({ lines })` cuts text to a few lines and says whether there is more as `overflowing`, its button a disclosure's over the text (51.122-51.124).
- e008a7b: `drawer`, a composed part. `drawer({ side })` is a `dialog` with a `resizable`'s panel laid over it: spread `drawer` on a `<dialog>` and `handle` on its inner edge, and it opens and dismisses as a dialog does, sizes from its handle as a resizable does, and carries `data-side` for the edge your CSS puts it on (50.61, 50.62). Give it `stops` and its handle, let go, settles it at the nearest stop — a flick carrying it on — and closes it below every stop, on any edge: `drawer({ side: 'bottom', stops: [0.5, 1] })` is a bottom sheet (50.63, 50.64).
- 22d5c6d: `dropzone` takes `onreject`, handed the files a drop or a paste carried that `accept` or `multiple` turned away (RULEBOOK 53.45)
- 77468e9: `observe` is three parts named for what each measures, and their options and `format`'s take the web platform's own names (RULEBOOK 32.79-32.92, 32.110, 32.112, 52.35, 52.112):
  
  - `observe.size(x, options)` → `elementSize(x, options)`; `box: 'content' | 'border'` → `box: 'content-box' | 'border-box'`, and `'device-pixel-content-box'` writes the size in device pixels.
  - `observe.visible(x, options)` → `elementVisible(x, options)`; `in: root` → `root: root`, and `IntersectionObserver`'s `rootMargin` and `threshold` pass through — in view from the smallest share `threshold` names.
  - `observe.rect(x)` → `elementRect(x)`.
  - The part each spreads is marked `data-element-size`, `data-element-visible` or `data-element-rect` where it was `data-observe`.
  - `format.money`, `format.percent` and `format.number` take `Intl.NumberFormat`'s options: `digits: n` → `minimumFractionDigits: n, maximumFractionDigits: n` (or `maximumFractionDigits` alone to drop trailing zeros), `compact: true` → `notation: 'compact'`, `signed: true` → `signDisplay: 'exceptZero'`. `format.bytes` takes `minimumFractionDigits` / `maximumFractionDigits` for `digits`. `format.list`'s `conjunction: 'or'` → `type: 'disjunction'`, and `style` passes through. `format.relative` takes `numeric`.
- c95cfef: `fetchData` replaces `fetchJson` and `fetchText`: one fetch with the same deadline, retries, cache and `schema`, reading the body as its `content-type` says, as `handle` reads one — JSON as its value, text as a string, anything else as a `Blob` — or as `as: 'json' | 'text' | 'blob'` names whatever the type says. `fetchJson(url)` becomes `fetchData(url)` (or `fetchData(url, { as: 'json' })` for a service that labels JSON as something else), and `fetchText(url)` becomes `fetchData(url, { as: 'text' })`. A JSON body that does not parse now carries the status it was answered at rather than `null` (RULEBOOK 54.12-54.14, 54.17)
- 8f58694: `handle` reads a `Response` you fetched yourself as its `content-type` says — `fetch(url).then(handle)` — JSON as its value, a JSON Lines or event stream as its chunks as they arrive, text as a string and anything else as a `Blob`, with a status outside 2xx a `FetchFailed`; your fetch keeps its headers, and what it throws reaches you untouched. A `FetchFailed` from `fetchJson` or `fetchText` for an attempt that threw carries the thrown error as its `cause`, which Problem Details never sends (RULEBOOK 54.30-54.34)
- 741061a: `form` tracks what an edit changed: `deal.dirty` and `deal.field(name).changed` read whether the form or a field differs from its baseline — the value the page renders it with, which a cleared field equals where none was rendered — written as `data-dirty` on the form and `data-changed` on the field; `deal.reset` is a reset button's part, disabled while nothing differs; `deal.changes` holds the args a submit would send, only those whose field differs; and a call answered without a failure makes what it sent the new baseline. An edit wakes only the readers of a field it moved. `message`, `invalid` and `issues` are now typed as the getters they are, so a template reading one by name stays bound (RULEBOOK 56.14-56.23).
- 6cdc73c: `dropzone` is parts: `dropzone(options?)` hands back `host` (spread on the drop or paste target, `data-dragging` while files hover), `input` (spread on an `<input type="file">`, the keyboard's way in, filtered as a drop is), `files` (what the last drop, paste or pick took, replacing what was there; bind your own with `files`) and `rejected`. Migrate `bind:element={dropzone(onFiles, options)}` to `{...dropzone({ ...options, onfiles: onFiles }).host}`; `onfiles` and `onreject` are optional and are handed the event as an `Event`. `form`'s parts take one shape: `form` for the `<form>` (was `element`), `field(name)` handing back the field's `input`, `error`, `message` and `invalid`, the whole form's `message` and `error` (was `message('')`), and `submit` and `issues` read as members (RULEBOOK 49.9, 53.17-53.20, 53.45, 53.56, 53.57, 56.9, 56.10, 56.13).
- 925833b: `form(handler)` hands back parts an app spreads onto a `<form>` and fields of its own. A submit reads the fields as a post carries them, checks them against the handler's args document before calling it — the same document the server holds the call to, so the browser's message is the server's — and shows what is wrong beside each field, from its own check or from the call's `ValidationError` alike. Focus goes to the first field with a message, an edit checks the form again, `submit` is disabled while the call is in flight, and a `POST`'s form posts to the handler with no script. The build now reads a handler's `args` written as `jsonSchema` over a literal as its args document, and a mutation's browser copy holds it (RULEBOOK 56.1-56.12, 19.28, 19.29, 19.13).
- ac319b8: `format.date` with no `timeZone` writes in the visitor's zone — UTC on the server and while the page hydrates, so the two agree, then the browser's own — or in the zone the app pins with `format.timeZone.set(zone)`, per request on a server (RULEBOOK 52.3, 52.44, 52.45, 41.32)
- 76844d0: Three helpers. `highlight(text, query, { words })` cuts a text into runs, each holding the query carrying a `match` part — the matcher `combobox` and `commandPalette` mark their lists with, handed to an app (52.110, 52.111). `shrinkImage(file, { maxEdge, maxBytes, type })` makes a picture small enough to send, lowering its quality and then its size to fit a byte budget, the same call where Bun runs (through `Bun.Image`) and in a browser (through a canvas), and hands a file already within bounds back as it is (53.87-53.89). `download(data, name)` saves text or bytes made in the page as a named file, and throws on a server (53.90, 53.91).
- 4fbd0a9: `toasts.host()` and `prompts.host()` are the notices' live region and the prompts' dialog as parts, called from the script of the one component that shows them and spread onto markup: the region, each notice, its action and close button; the dialog, its form, the field, the error and the two buttons. `Toasts` and `Prompts` are default markup over them (RULEBOOK 50.6, 50.10, 50.17, 50.34, 50.36).
- 2fa9297: `inlineEdit({ value, save })`, a value edited where it stands: spread `view` on a button showing it and `input` on a field. A press opens the field holding the value, selected; Enter or leaving it calls `save` and waits on it before `value` changes, Escape puts it back, and focus returns to the button. A save that throws keeps the field open with `error` naming why, the field disabled while one is in flight (56.24-56.28).
- 5ea6ff3: `job` takes `from: 'start'`, measuring `every` from when the last run started rather than ended; a run due while the last one overran starts at the look after it ends (RULEBOOK 54.29)
- 8bb8464: `jsonInspector` searches and inspects a JSON value as parts an app spreads on markup of its own: a search field, and `tree`'s parts over a row per value told apart by its JSON Pointer, rendered flat. A search shows only the matches and the rows holding them, opened, marks each match in runs, and leaves `expanded` as it was (RULEBOOK 51.157-51.165). `tree` hands back `shown`, the nodes that show in order, so any tree can render as one flat list (51.156)
- 84869f9: **What tells one element from another is `key`, everywhere.** `reactive`'s `by` option is now `key`, and a `{#for}` names its key with `key` where it used `by`: `{#for deal of deals key deal.id}`. It is the word the headless components' `key`, the server's `table(…, { key })`, and every other framework's list key already use. A `{#for}` with no key still takes its `Reactive`'s, as it took its `by` (RULEBOOK 32.32), and a `GET`'s value carries `key` to its browser copy as it carried `by`.
  
  `key` is a common name, so in a `{#for}` head it is the separator only where it follows the subject: `{#for letter of key}`, `{#for letter of a + key}` and `{#for letter of key.split('')}` all walk `key` and name no row key.
  
  **Breaking**:
  
  - `reactive(value, { by })` → `reactive(value, { key })`, and the same on `memo` and every value a body declares.
  - `{#for item of list by expression}` → `{#for item of list key expression}`. `abide format` writes the new spelling once the source is changed; the build refuses nothing new, so a `by` left in a template is read as part of the subject and fails to type-check.
- 8d66604: `ledger({ store, retain, ttl, schema })` keeps events appended and never coalesced, and is itself a `Reactive` of every entry it keeps — `{#each calls as call}` in a page, patched in place as entries are kept or let go: `append(entry, { key })` numbers each one past the last (a key already appended keeps nothing), `read(from)` hands on every entry past a position in order and waits for the next — and errors with a 410 where entries it had not reached were let go — and `read({ cursor })` resumes where that cursor's reader left off — an entry counts as done once its reader asks for the next. `writable` appends what is piped to it. Entries are kept until `retain` (a count) or `ttl` (an entry's life in milliseconds) lets them go, and a key goes with its entry. `store.sqlite`, `store.indexedDB` and `store.redis` keep a ledger as one record per entry — in Redis a Stream, each append one script on the server so concurrent processes never take one number or keep one key twice —, with its cursors beside them, and an append another tab makes to an IndexedDB ledger reaches this tab's value and wakes its reads. `GET(calls)` serves a ledger to a page, each append reaching it as a JSON Patch; a reader resuming from a position reads a streaming `GET` yielding `read(after)`, and a `POST` appends with a key the page makes, so an outbox resend keeps one entry.
  
  `table(database, name, { key })` from `@abide/abide/server` is a SQLite table as a stream pair: `readable` hands on every insert, update and delete committed after it is first read — captured by triggers in the writer's own transaction, whoever wrote it — and `writable` upserts rows by `key`, a turn's writes in one transaction. A change to the table refreshes every value whose `tags` name it.
- 76fce80: `lightbox`, a `carousel` in a `dialog`: spread `dialog` on a `<dialog>` and the carousel's parts inside it, and `show(key)` opens it resting on that item, the arrow keys bound with `hotkeys` to the carousel's own `previous` and `next` (50.65-50.67).
- ebaf8d6: `listbox`'s keyboard listener is `onkeydown`, as every listener a headless component hands back or takes is named `on<event>` (RULEBOOK 49.13): write `onkeydown={queue.onkeydown}` where you wrote `onkeydown={queue.keydown}`.
- b131e49: `listbox` hands back parts: `listbox` for the list and `option(key)` for each option, carrying its id, `role`, `aria-selected`, `data-active` and the pointer that activates it — spread them rather than writing each attribute (RULEBOOK 51.94). `combobox` and `commandPalette` build their options on it.
- b7be9fd: **breaking:** a click on a `listbox` option now makes it active and calls `onpick` with it, as Enter does, so an option no longer needs an `onclick` of its own (RULEBOOK 51.105). `listbox` and `tree` take `multiple: true` and select many, as `combobox` does, holding the keys in `selected` (`Reactive<Picked<string, Multiple>>`, read and set): a click selects one, ⌘ or Ctrl with it adds or takes one out, Shift takes the run from the last one picked, Space toggles, Shift with an arrow extends and ⌘A or Ctrl+A selects all, written as `aria-multiselectable`, `aria-selected` and `data-selected`. A `listbox` selecting one hands back the key last moved to as `selected` (RULEBOOK 51.98-51.104, 51.79, 51.83)
- 121dfed: A listener written on an element no longer replaces a spread's listener of the same event: every `on<event>` an element carries, written or spread, is added, the written ones first and then each spread's in source order (RULEBOOK 32.109). `<button {...filters.trigger} onclick={track}>` now opens the popover and calls `track`, where before `track` silently replaced the trigger's own click. Attributes are unchanged: a written attribute still beats a spread's (33.12). On a component, `on<event>` is still an ordinary prop.
- d53ad3c: `markdown` and `Markdown` take `blocks`: a fenced block whose language is one of its names renders as the caller's markup (`markdown`) or component (`Markdown`), handed its source and the rest of its info — a chart, a callout, a code block with a Copy button. `href` may answer the address with the `target` and `rel` it opens with, and a reference link (`[text][label]`, `[text][]`, `[label]`) takes its address from a definition anywhere in the source (RULEBOOK 52.40-52.43)
- 584b528: `markdown` and `Markdown` render model output as a model writes it: `<br>` and a short list of attribute-free formatting tags (`<kbd>`, `<sup>`, `<sub>`, `<b>`, `<i>`, …) are markup rather than text, numeric and common named character references are their characters, `[ ]`/`[x]` list items are checkboxes, and math is kept as its TeX in a `data-math` element. Given `streaming`, both leave out what the end of a stream is still writing — an unclosed mark, a half link, a table's head before its delimiter — until it can't change (RULEBOOK 52.46-52.50).
- f84d2f4: `combobox`'s `runs(item)` and `commandPalette`'s `command(command).runs` cut a label into `LabelRun`s where what was typed was found — by the same match that narrowed the list, so the two never disagree — each matched run carrying a `match` part to spread on a `<mark>`. `Combobox` and `CommandPalette` mark what was typed in each option (RULEBOOK 51.106-51.107)
- bacf8b7: Inside a `.abide`, a member typed as a `Reactive` is read and written by name as a name is: `ask.open ? 'yes' : 'no'` reads it and `ask.open = true` writes it, where both used to see the `Reactive` object. `route`'s five values are now one case of this rather than a list of their own. A `Reactive` assigned where none is yet — a `let` declared with none, a member a constructor sets, a new key — is bound to it rather than written into `undefined`; a read of an option that may hold no `Reactive` reads `undefined`; and `options.open ?? reactive(false)` keeps the `Reactive` where one is due. `dialog`'s `open` is optional and handed back, as `menu`'s is, so `ask.open = true` opens one (RULEBOOK 31.15, 31.19-31.21).
- 415b2a7: A value computed by a body is a `memo`: `memo(() => seats * price)`, `memo(({ id }) => getDeal({ id }))`, `memo(async function* () { … })`. `reactive` holds a value and only a value — a function handed to it is held, not run — and `memo` handed anything but a body throws where it is written. Both hand back the same `Reactive`. `abide upgrade` renames every `reactive` handed a body to `memo` and imports it.
  
  Inside a `memo` body, `stopSignal()` is that run's own signal: aborted when the next run replaces it, when the value is released, and when the app stops — so a fetch a keystroke made obsolete stops rather than finishing for nobody.
- f3720d7: `menu` takes `openOnHover` (milliseconds a mouse or pen rests on the trigger before it opens; a touch never hovers), `closeOnLeave` (milliseconds after the pointer leaves trigger and menu before a pointer-opened menu closes; one a key opened stays) and `group` (menus sharing a name switch between each other: the pointer on another's trigger while one is open, or ArrowLeft and ArrowRight). A menu a group switches to carries `data-from` and the one it left `data-to`, the side the other stands on, for a transition (RULEBOOK 50.55-50.58).
- e7a1ee2: `menu` opens in a `popover` of its own rather than a second implementation beside it (50.37): it takes every option a `popover` does, `escape` and `outside` included, and its menu is a manual popover a press outside and Escape close as any `popover` is (50.60), where it was an `auto` popover the browser light-dismissed. A menu opened by writing `open` is placed against the new `anchor` part: spread it on what the menu opens against. `onopen` and `onclose` are gone — watch `open`, which every way the menu opens or closes writes.
- a0383c9: **breaking:** `Menu.abide` is replaced by `menu(options)`, two parts an app spreads onto elements of its own — `<button {...actions.trigger}>` and `<div {...actions.menu}>` — so the trigger holds anything and carries its own attributes. `open` takes a `Reactive` the menu writes back on every close, beside `onopen` and `onclose`; `menuitemcheckbox` and `menuitemradio` items change state with the menu left open; and typing moves focus to the item starting with what was typed (RULEBOOK 50.28-50.32, 50.37-50.40)
- 94d34eb: `menu` takes every placement option `popover` does, `margin` among them, under its own defaults (`side: 'bottom'`, `align: 'start'`, `offset: 4`), as `tooltip.tip` does (RULEBOOK 50.19-50.21).
- 2e0fcd3: `meter` and `pages`. `meter({ value, min, max })` is a track and a fill: `role="meter"` with the value read out, the fill as wide as the value is along its range, and `data-level` of `low`, `middle` or `high` where `low` or `high` is given; `role: 'progressbar'` with no value is indeterminate (52.106-52.109). `pages({ count })` is pagination: `items` lists the first page, the last and those around the page on, folding the rest into gaps, with a `link` per page, `previous` and `next`; given `href`, each is a link to its page's address (51.125-51.129).
- b0044b9: `hotkeys` and `keyLabel` read a native menu's modifier spellings — `cmd`/`command` as `meta`, `option` as `alt`, `control` as `ctrl` — and a `MenuItem`'s `key` reads `meta` and `mod`, so one shortcut string labels, matches and fills the menu bar alike (RULEBOOK 53.9)
- d99c0e9: **`notices(options)`**: build a list of notices. It has the same `notify`, `dismiss`, `list` and `host` that `toasts` has, and `toasts` is now `notices()`. A list can start with `initial` notices, which are rendered on the server too. Given a `store`, such as `store.cookies(...)`, it remembers each notice that was closed or whose action was taken, for `ttl` milliseconds. A remembered notice is left out of the server's render. A notice's `id` is now a string: the `id` given in `NotifyOptions`, or by default a hash of the notice as JSON, so the same notice has the same id on the server and on every page. Notifying with an id the list already holds adds nothing and hands back that id. The list's `key: (notice) => string` decides what a dismissal is remembered by, the notice's `id` by default. Whatever it answers is stored as a short hash, so the cookie stays small however long the words. `NotifyOptions` gains `expires` (a `Date` or epoch milliseconds), the moment a notice stops showing.
  
  **Breaking**: the notice types are renamed:
  
  - `Toast` → `Notice`, whose `id` is a string, and which gains `expires`.
  - `notify` hands back a string id, and `dismiss` takes one.
  - `ToastsHost` → `NoticesHost`.
  - `ToastParts` → `NoticeParts`.
  - `ToastsHostOptions` → `NoticesHostOptions`.
  - `host.toast(notice)` → `host.notice(notice)`, and the parts' `toast` part → `notice`.
  - `data-toasts` → `data-notices`, and the `toast` element is now `data-notices="notice"`.
  - The missing-host warning is now on `abide:notices` rather than `abide:toasts`.
- 7708beb: `observe.size()`, `observe.rect()` and `observe.visible()` take no target: each hands back `host` to spread and its fields read by name — `size.width`, `rect.top`, `seen.visible` — each a value of its own, `undefined` until the first reading. The target forms are unchanged. RULEBOOK 32.110.
- 5b8ee39: `Outlet` and `fill` (`import Outlet, { fill } from '@abide/abide/Outlet.abide'`): a layout leaves a named place with `<Outlet name="actions" />`, and a page, a layout or a component below it hands a component to it with `fill('actions', Component, props)`, rendered there in the order the fills were made for as long as the setup that made each stands. A fill made in a page's or a layout's setup is painted by the server inside the outlet and adopted there by hydration; of two outlets under one name the last renders; a fill no outlet of its name stood for warns once on `abide:fill` (RULEBOOK 35.20-35.24).
- 872e4a8: `Outlet` and `fill` are replaced by `outlet.host` and `outlet.into`, two parts from `@abide/abide` (RULEBOOK 35.20-35.24). Spread `outlet.host('actions')` on the element a layout leaves, and `outlet.into('actions')` on each element a page writes for it — inline, reading and writing the page's own state, with no component to hand over. The browser moves each into the host, in the order they were bound, after what the host's own markup holds, and takes it out when it is unbound; of several hosts under one name the last holds them, and a host carries `data-empty` while it holds none. The server writes an `into` where the page wrote it, `hidden`, so hydration adopts it in place and nothing shows in the wrong place before the move. `@abide/abide/Outlet.abide` is gone: write `<header {...outlet.host('actions')}>` where you wrote `<header><Outlet name="actions" /></header>`, and `<button {...outlet.into('actions')}>` in the page where you wrote `fill('actions', Button)`. The warning for a name no host stands under is on `abide:outlet`.
- 9ff91ed: `Pairing` takes the step `slow` after `slowAfter` milliseconds of connecting, offering a Try again that calls `pairing`'s new `retry`; the step `offline` while the visitor has no network; and a `Message` component rendering each step's words (RULEBOOK 44.102, 53.41, 53.48-53.49)
- 429fb5e: `panZoom`, a surface moved and magnified: spread `surface` on the element that clips and `content` on what moves inside it. A wheel pans, and with Ctrl or ⌘ — or a trackpad's pinch — zooms about the pointer; a drag pans, two pointers pinch, a double click zooms in, and the keys pan, zoom and go home (53.92-53.96, 53.98). `fit(box, margin)` frames a region of the content, and the magnification keeps to `min` and `max` (53.95, 53.97).
- 3dc4edd: A part now names its element under a `data-` attribute named for the headless component that hands it back, in place of `data-part`: `data-sortable-table="row"`, `data-virtual-list="item"`, `data-toasts="toast"` for `toasts.host`. Parts from two functions spread on one element both stand — a `virtualList` item on a `sortableTable` row, or `autoscroll`'s host on `Chat`'s transcript, where one used to overwrite the other. A `combobox` or `commandPalette` option carries its own attribute beside the `data-listbox` of the `listbox` part it is built on. `Chat` and `Pairing` write `data-chat` and `data-pairing`. A selector reading `[data-part=x]` reads `[data-<function>=x]` (RULEBOOK 49.3).
- e2e46bc: abide ships no `.abide` components. Every `@abide/abide/<Name>.abide` entry is gone — `Dialog`, `Prompts`, `Toasts`, `Tooltips`, `Announcer`, `Combobox`, `CommandPalette`, `Range`, `SortableTable`, `Chart` with `Line`, `Column` and `Area`, `Pie`, `Sparkline`, `Markdown`, `Chat`, `Time` and `Pairing` — and each widget is the headless component it was markup over, spread on markup the app writes. `prompts`, `toasts` and `announce` import from `@abide/abide`, shown where the root layout spreads `prompts.host()`, `toasts.host()` and `announce.host()` (and `tooltip.host()` for hints). A chart hands `chart` its `series` directly. What the components did beyond their parts moved into them: `chat(options)` is a conversation over an assistant handler as parts — the transcript, each turn and piece, and the composer that sends, queues, stops and takes images; `markdown.incremental(options)` is a document as sections that keep their identity, and so their nodes, while a stream grows it, a fenced block named in `blocks` handed back for the app to render; and `pairing(options)`'s `step` is now where the pairing stands in full — `connecting`, `slow` after `slowAfter`, `offline`, `unavailable`, `click`, `waiting`, `install` or `paired` (RULEBOOK 49, 52.17, 52.18, 52.43, 53.31-53.49).
- d5fba62: Every headless component shapes its options one way (RULEBOOK 49.10, 49.11): an option that is a value takes the value or a function answering it, and each option is read where it is used, so a function or an accessor handed in stays live. `listbox` and `combobox` take their options as a list as well as a function, `chart` its `series`; `commandPalette`'s `hotkey` and `label`, `range`'s `labels` and `name`, `dropzone`'s `paste` and `multiple`, `tooltip.tip`'s `side` and `delay`, and every placement option of `popover`, `menu` and `tooltip.tip` take a function too. An option a function answers `undefined` for takes its default, as one left out does. `tabs`, `tree`, `range`, `menu`, `chart` and `commandPalette` take an `id` and hand it back, as `listbox` and `combobox` do (49.8). An `id`, a `multiple`, a `debounce`, a `rowHeight` and a starting size are read once.
- 89f0290: Every headless component now has one shape (RULEBOOK 49.3, 49.8, 49.9): each element's part writes its own `data-part`, so a shipped component writes none and CSS written against a component matches an app's markup over its parts; every option an app binds is optional and handed back as a `Reactive` of the same name, ids are made where none is given, and a string or a number is its own `key` and `label`; and the parts are a member per element there is one of, a function per item, and an accessor for whatever changes — never a function taking nothing, or an optional argument, to read a value.
  
  Migration:
  
  - `tabs`: `view.tab(key)` → `view.tab(key).button`; `view.panel()` → `view.panel`; `view.panel(key)` → `view.tab(key).panel`; `view.current` → `view.selected`.
  - `listbox`: `list.active()`, `list.activeOption()`, `list.activeId()` → `list.active`, `list.activeOption`, `list.activeId`; `id` is optional, and `key` too for string or number options.
  - `menu`: unchanged in shape; its trigger and menu write `data-part="trigger"` and `data-part="menu"`.
  - `combobox`: `id`, `key`, `label` and `value` optional, `multiple: true` picks many in place of an array `value`; `box.open()`, `box.items()`, `box.nothingFound()`, `box.picks()` → `box.open`, `box.items`, `box.nothingFound`, `box.picks`; `box.remove(item)` → `box.chip(item).remove`, with `box.chip(item).chip` and `box.chips` for the chips; `box.value` and `box.id` handed back.
  - `commandPalette`: `palette.option(command)` → `palette.command(command).option`, with `.label` and `.key`; `palette.results()` → `palette.results`.
  - `range`: `value` optional (from `min` to `max`) and handed back; `thumb(which)` / `input(which)` → `end(which).thumb` / `end(which).input`.
  - `sortableTable`: `rows()` → `rows`; `header(column)`, `sort(column)`, `cell(column)` → `column(column).header`, `.sort`, `.cell`; `row(row)`, `select(row)` → `row(row).row`, `row(row).checkbox`, with `row(row).select` the cell holding it and `row(row).detail`; `selectAll` → `selectAll.checkbox`, with `selectAll.select` its cell; `table.table`, `table.sort` and `table.selected` handed back.
  - `tree`: `item(node)`, `group(node)`, `isExpanded(node)`, `toggle(node)` → `node(node).item`, `.group`, `.expanded`, `.toggle()`; `key` and `label` optional for string or number nodes; `expanded` and `selected` handed back.
  - `time`: `time(value)` / `text(value)` → `at(value).time` / `at(value).text`.
  - `toasts.host`: `notices()` → `notices`; `notice(toast)`, `action(toast)`, `close(toast)`, `act(toast)` → `toast(toast).toast`, `.action`, `.close`, `.act()`, with `toast(toast).text`.
  - `prompts.host`: `current()`, `typing()`, `failed()` → `current`, `typing`, `failed`, with `title`, `body`, `field` and `actions` parts.
  - `tooltip.host`: `text()` → `text`.
  - `chart`: `frame()`, `yTicks()`, `xTicks()`, `zero()`, `marks()`, `lines()`, `areas()`, `bars()`, `points()`, `readout()`, `crosshair()` → the same names read as values; a mark carries `columns`, the readout `heading` and each value `text`. `pie`'s `slices()` → `slices`; `sparkline`'s `trend()`, `ended()` → `trend`, `ended`.
- 94f2583: **Headless components over a list take its items, and tell them apart by `id`.** `tabs`, `toggleGroup` and `wizard` take the items themselves, where they took a list of keys, and a part for one item is a function of the item: `view.tab(item)`, `group.item(item)`, `steps.step(step)`. `listbox`'s `option` takes the option, not its key. Every headless component's `key` is now optional where an item carries an `id`, which is its key, as a string or a number already is. So `tabs({ items: VIEWS })` over `{ id, label }` records needs no `key`, and the `key: (deal) => deal.id` that `carousel`, `sortableList`, `tree`, `listbox`, `combobox`, `sortableTable` and `virtualList` asked for can go.
  
  **Breaking**:
  
  - `tabs({ keys })` → `tabs({ items, key? })`, and `tab(key)` → `tab(item)`. `TabsOptions` and `Tabs` take the item type.
  - `toggleGroup({ keys })` → `toggleGroup({ items, key? })`, and `item(key)` → `item(item)`. `ToggleGroupOptions` and `ToggleGroup` take the item type first.
  - `wizard({ steps })` takes steps of any type with `key?`, `step(key)` → `step(step)`, and `valid` is handed the step. `WizardOptions` and `Wizard` take the step type.
  - `listbox`'s `option(key)` → `option(option)`.
  - `playback`'s `speed` is a `ToggleGroup<number>`: `speed.item(rate)` takes the rate as a number.
- 31ed02e: A pattern beside `busy`, `ready`, `synced`, `refresh`, `invalidate` and `outbox` matches args that HOLD it, as `authorize` matches a principal: an array names items the args' array holds in any order beside others, and a nested object names some of its members — `refresh(getDeals, { stages: ['won'] })` reaches `{ stages: ['won', 'lost'] }`, where before an array in a pattern matched nothing (RULEBOOK 13.12)
- ffe1ce2: `pipe(steps, options)` runs each item through steps in order — a list in the steps is one step whose members run at once on the same input, and a step that yields hands each chunk on as an item of its own. At most `concurrency` items run at once (one where none is given), counted per `key` where one is given, and a pipe used as a step of others is one budget for all of them. Each step's attempt is retried up to `retries`, spaced by `backoff`, ended at `timeout`, and a `Retry-After` holds the step for every item. `paused` holds new attempts while it reads true; `stop()` ends the pipe. Calling a pipe answers a `Reactive` of that item's answer, as calling an `Rpc` does — `busy()` while it runs, a refusal as its `error()`, and awaited it rejects with that refusal; a pipe is also a `readable` / `writable` pair to `pipeThrough`, which builds no `Reactive` per item, with its `status` as one `Reactive`. A pipe called in a `memo` body is told when the run is superseded.
  
  `fetchJson` and `fetchText` take `backoff`: the first wait, doubled per retry, or a function naming each wait. `job` takes `paused`, and a job's run is no longer aborted by the look after it where it overruns under `from: 'start'`.
- f5b32f9: `place` is internal: an app's own overlay is a `popover`, which places it, keeps it placed as anything moves, and writes `data-side`, `--arrow-offset` and `--anchor-width`. Migrate `place(anchor, floating, options)` and the `inset` you wrote from it to `bind:element={popover(anchor, options)}` on the floating element. `PlaceOptions` is `PopoverOptions`, and `Placement` is gone; `Side` stays. 50.19-50.22 and 50.35 now govern every anchored layer (RULEBOOK 50.19-50.22, 50.26, 50.27, 50.35).
- 0d9fafd: an open `Tooltip` or `Menu` is placed again when it or its anchor changes size, not only on a scroll or a resize; and `place`, `Tooltip` and `Menu` take `arrowInset`, the pixels the arrow keeps from the corners (RULEBOOK 50.26, 50.35)
- 0cb5d0c: `playback({ duration })`, a clock and its controls for replays, animations and timelines: one frame loop moves `at` while `playing`, by the time passed times `rate`, stopping or starting over at its end (51.130, 51.131). Its parts are made of public ones — `play` is a `toggle`'s button, `speed` a `toggleGroup` over `rates`, and `root` binds Space and the arrows with `hotkeys` — beside a `scrubber` for an `<input type="range">` (51.132-51.135).
- 11431a8: `popover(anchor, options)` is a `bind:element` adaptor opening an app's own panel in the top layer against an anchor for as long as it is bound, placed and placed again as `Tooltips` and `menu` are, writing `data-side`, `--arrow-offset` and the new `--anchor-width` (RULEBOOK 50.26, 50.27, 50.48). `Combobox` now opens its list in the top layer as one: the list and the children shown when nothing matches sit in a `data-part="popup"` element under the input, so no `overflow` or scroller clips it (51.57). Migrate CSS that positioned `[data-part=listbox]` inside the combobox to style `[data-part=popup]` instead — give it `margin: 0` and a background, and `width: var(--anchor-width)` to match the input.
- 7ec3cf8: `popover` and `dismissible` hand back parts for each element they involve, so no element is handed from one to the other. `popover(options)` returns `{ trigger, anchor, popover, open, id }`: spread `trigger` on the button that opens it (or `anchor` on a field that opens it some other way) and `popover` on the panel. `open` is a `Reactive` you may pass in, and a press outside or Escape closes it unless `outside` or `escape` is `false` (RULEBOOK 50.48, 50.59, 50.60). The panel stays mounted and is shown and hidden in the top layer, so drop the `{#if open && opener}` around it, the `bind:element={opener}` ref and the `dismissible` beside it. `dismissible(onDismiss, options)` returns `{ host, inside }`: spread `host` on the panel and `inside` on the button that opens it, in place of `{ inside: [opener] }` (53.12).
- 805c330: `range(options)` is the two-thumb slider as parts an app spreads onto markup of its own — `root`, `track`, `fill`, `thumb(0 | 1)` and `input(0 | 1)` — and `Range` is now default markup over those parts, behaving as it did (RULEBOOK 51.85-51.91).
- d4c7362: `Range`: a low and a high value picked on one track by two thumbs, which the native `<input type="range">` cannot hold — WAI-ARIA's multi-thumb slider, dragged by the pointer, stepped by the arrows, Page Up and Page Down, and submitted with a form under `name` (RULEBOOK 51.85-51.91).
- 07d5f7d: `format.relative` takes a `style` — `short` writes `12 min. ago`, `narrow` writes `12m ago` (RULEBOOK 52.32)
- 1168778: `requireRole(role, { status: 404 })` answers a caller without the role as an address nothing serves — the same `NotFound` the router answers — for an app that hides what exists (RULEBOOK 54.28)
- c20ceba: `resizable`, WAI-ARIA's window splitter as parts: spread `panel` on a panel and `handle` on its edge, and dragging the handle sizes the panel along `axis`, toward the `edge` it stands on (53.80, 53.81). The size keeps to `min` and `max`, and where `keep` is given to the parent's room less what stands beside it (53.82); the arrow keys of its axis step it, Home and End take it to its bounds, Enter collapses and restores it, and a double click gives it back its own size (53.83-53.85). One per axis spread on one grip sizes a box from its corner.
- cd6a611: Breaking: `Router` from `@abide/abide/routing` no longer carries `region`. Nothing read it; the page region is `LevelChain`'s, and a test that needs it finds it in the document.
- ed81459: `scrollEdges`, a `bind:element` adaptor writing on a scrolling element a `data-scrollable` attribute listing the edges it can still scroll toward — `top`, `bottom`, `start`, `end` — so a stylesheet fades or shadows them. `start` and `end` follow the scroll origin, so a right-to-left scroller is marked the right way round, and rows arriving and leaving, text or an attribute changing anywhere inside, and an image loading inside all mark it again. Every read is made in one animation frame before any write (RULEBOOK 32.101-32.108).
- 1667ac8: `scrollSpy` marks the section of a long page scrolled to, as parts spread onto a nav of links: give each section an `id` that is its item's key, spread `host` on the nav and `jump(item)` on a link per section. Each link is a real `href="#key"`, and a click scrolls as `behavior` names to where the browser would land the section — its `scroll-margin-top` and the scroller's `scroll-padding-top` counted, so a sticky header is said once in CSS — and writes the fragment. The first section is current at the top and the last at the end of the scroller; offsets are measured a frame after binding and whenever something holding a section resizes, so a scroll reads no layout (RULEBOOK 51.169-51.177).
  
  `scrub` on `scrollSpy` and on `virtualList` turns the jumps into an alphabet scroller: a press dragged along them clicks each jump it reaches once, past disabled ones, with `data-scrubbing` on the host meanwhile (51.167, 51.168).
  
  BREAKING: `VirtualListSections` is now `Sections<VirtualListSection>` — the one jump index type `virtualList.sections` and `scrollSpy` both hand back.
- b7ac4e5: Breaking: `sortRows` is replaced by `sortBy(items, value, direction?)`, a general sort: a new array of `items` ordered by the value `value` answers for each, ties kept in order, blanks last in either direction, numbers and dates compared as themselves, and text compared in abide's locale with its numerals by value, so a list the server sorts is in the order hydration sorts it (RULEBOOK 51.43-51.46, 51.48). `sortableTable` sorts its rows through it. Replace `sortRows(rows, columns, { key, direction })` with `sortBy(rows, (row) => row[key], direction)`.
- a6a6f9a: `sortableList({ items, key, label, multiple })`, a `listbox` put in order by hand: spread `list`, each `item(entry).item`, and a grip on each as `.handle`. The list is one stop in the tab order whose keys and selection are the listbox's — click, ⌘ or Ctrl click, Shift click, ⌘A and Shift with the arrows — and Alt with ArrowUp or ArrowDown moves the active item, or the whole selection where it is in it, a place at a time. A grip dragged places its item, or the selection it is in, among the others by the pointer. Each move is read out through `announce`. `sorted` is the items in the order put, `order` their keys, and `selected` the listbox's (51.145-51.151).
- 344450c: `sortableTable` is a sortable, selectable table as parts an app spreads onto a `<table>` of its own, writing every cell: each header's `aria-sort` and sort button, the rows in sorted order, and a checkbox per row with a Shift-click range and a mixed header box. `SortableTable` is now default markup over those parts and behaves as before. A `{...expr}` spread onto an element now carries an element binding under `bind:element`, handed the element at mount as `bind:element` hands it, which is how a part sets a property no attribute can (RULEBOOK 32.99, 51.49-51.54, 51.72-51.76).
- 8b80ba6: a `Column` takes `firstDirection`, the direction a first press of its header sorts in, and `SortableTable` takes `rowAttributes`, spread onto each row's `<tr>` — a `class`, a `data-` state, an `onclick` (RULEBOOK 51.50)
- db68e42: `SortableTable` takes `selected`, the keys of the rows picked: given it, a checkbox named for its row leads each one and a mixed one heads them all, a Shift-click picks every row from the last one clicked, and each picked row carries `data-selected`. Bind it to read and set the pick (RULEBOOK 51.72-51.76).
- adee697: `Sparkline` takes `kind: 'bar'`, drawing each value as a bar up from zero in place of the line — a count reads by its length (RULEBOOK 52.33)
- 2e3ac78: `spoiler({ open })`, a cover button standing in the place of content until it is pressed. The content is hidden outright while covered — not `until-found` — so find in page and screen readers do not reach it, and pressing the cover hides it and moves focus to the content (51.152-51.155).
- 0d05778: `stepper` and `wizard`. `stepper({ min, max, step })` is WAI-ARIA's spin button: a field the arrow keys step, PageUp and PageDown ten at a time, Home and End to its bounds, with buttons either side outside the tab order, and a number typed kept to its bounds and its step (56.29-56.32). `wizard({ steps, valid })` takes a task in steps: a marker per step, the one on `aria-current="step"` and those before it a way back, `next` waiting on `valid`, and `progress` a `meter` of how far it has come (51.141-51.144).
- dfb693e: **breaking:** `Tabs.abide` is replaced by `tabs({ keys, selected })`, parts an app spreads onto elements of its own — `list`, `tab(key)` and `panel()` — so a tab holds anything, and `panel(key)` gives each tab a panel of its own, hidden while another is selected and kept (RULEBOOK 51.34-51.42)
- add8fbf: `time(options)` is a time kept current as parts: `seen.time(at)` spread onto a `<time>` carries its `datetime` and `title` and is followed by the page's one clock for as long as it is bound, and `seen.text(at)` is its label, so one set of parts serves every row of a list. `Time` is default markup over it (RULEBOOK 52.72, 52.73).
- 53c74f0: `Time` writes how long ago or how soon a time is, as `format.relative` does, in a `<time>` with its `datetime` and the full date as its `title`, and keeps it current: one clock ticks every `Time` on the page at the moment the soonest label next reads differently, sets no timer while the page is hidden or no `Time` stands, and a tick writes only the labels that turned (RULEBOOK 52.72-52.77).
- 94d34eb: A notice's parts from `toasts.host` carry `dismiss()` beside `act()`, so markup of an app's own closes a notice without importing `toasts.dismiss` (RULEBOOK 50.15).
- c1042cd: `Toasts` takes `Toast`, a component rendering each notice's content — handed the notice, `dismiss` and `act` — inside the element carrying its attributes and tone; an element in it whose `bind:element` hands back an animation's `finished` keeps the notice in the page until it ends (RULEBOOK 32.38)
- 84f7c41: `toggle` and `toggleGroup`, two headless components for buttons that hold a choice. `toggle()` is a button that stays pressed — `aria-pressed`, or an on/off switch with `role: 'switch'` — and hands back `pressed` to read and write (51.108, 51.109). `toggleGroup({ keys })` picks one key as a radio group, the arrow keys moving the pick and focus together with one stop in the tab order — a segmented control (51.111-51.114); with `multiple: true` it is a `toggle` per key, each pressed while `value` holds it — filter chips (51.110).
- d45ea96: **breaking:** `Tooltip.abide` is replaced by `tooltip.tip(text, options)`, a `bind:element` adaptor on the element it explains, and `Tooltips.abide`, rendered once in the root layout as the one popover every hint opens in. Nothing is written beside the anchor, and the text describes it through `aria-description` (RULEBOOK 50.23-50.27, 50.36)
- c9ec762: `tooltip.host()` is the popover hints show in as parts, as `toasts.host()` and `prompts.host()` are: called from the script of the one component that shows hints and spread onto markup — `<span {...hints.hint}>{hints.text()}</span>`. `Tooltips` is default markup over it. Hints are text only. A `chart`'s readout opens in its own `tip` part against the crosshair rather than in the page's `Tooltips`, and `crosshair()` takes no hint (RULEBOOK 50.46, 50.53-50.54, 52.79).
- 8aefa32: `tree`: WAI-ARIA's tree as parts an app spreads onto elements of its own — the tree, an item per node and the group of its children — whose arrow keys move through what shows, open and close branches, and jump by letter as a `menu` does (RULEBOOK 51.77-51.84).
- 516d872: `trustedIdentity({ header, proxies, claims })` signs in the caller a single sign-on proxy in front of the app names in a header — believed only on a request whose peer, as `request.ip` answers it, is one of `proxies` — for that request alone, with no cookie sealed, so `signedIn` and `requireRole` admit them as any caller (RULEBOOK 54.35-54.37)
- e1fc27e: A turn's `AssistantContent` is every content block the Messages API takes in a user turn: an image at a URL or uploaded to the Files API, a document at a URL, of content of its own or uploaded, with its `context` and `citations`, a `search_result`, and `cache_control` on any of them. `assistant` hands on what abide carries no bytes of and lets the API judge it, and `assistantMessage` takes a `URL` and a block built by hand beside words and files — `assistantMessage('user', [new URL('https://bank.example/q3.pdf'), 'What did I hold?'])`. `provider.claudeCode` refuses a block cached for less than an hour, which Claude Code's own breakpoints would make the API refuse (RULEBOOK 44.36, 44.37, 44.55, 44.103)
- 869ad6b: A turn's content is the Messages API's own blocks, and a person's turn of a question and its attached files is `assistantMessage('user', parts)`, words and files as blocks in the order given — `assistantMessage('user', ['Was this receipt', receipt, 'paid by this invoice?', invoice])`: a photo drawn down as `imagePiece` drew it, a PDF as a `document` block, and a CSV, JSON or text file as a text `document`, each titled with its file's name — so a statement or a spreadsheet goes to the model as it is, through `provider.claudeApi` and `provider.claudeCode` alike (RULEBOOK 44.36-44.38, 44.52-44.55, 53.37). `chat`'s composer takes them too, and shows a document part beside an image.
  
  Migrating:
  
  - `imagePiece(file)` → `(await assistantMessage('user', [file])).content[0]`, or build the whole turn: `await assistantMessage('user', [...files, question])`.
  - `imageFiles` → a `dropzone` `accept` string, e.g. `'image/*,.heic,application/pdf,text/*,.csv'`. `dropzone`'s `accept` no longer takes a function.
  - An image piece `{ type: 'image', data, mimeType }` is now `{ type: 'image', source: { type: 'base64', media_type, data } }`, and `assistant` refuses the old shape 400 (RULEBOOK 44.36). A stored transcript holding images must be rewritten into the new shape — there is no reader for the old one.
  - A `ToolAnswer`'s content is unchanged: MCP's own `{ type: 'image', data, mimeType }`.
- 9a09353: `virtualList` renders only the items of a long list or grid that are in view, measured from the app's own markup rather than described to it: spread `host` on the element the items sit in, render a keyed `{#for}` over `shown`, and spread `item(entry)` on each. How many items a row holds and how tall a row is come from the items as they render and the host's width and gaps, so a CSS grid whose columns change with a breakpoint just works; the scroller is the nearest scrolling ancestor or the page; and the rows left out are the host's block padding, so no spacer breaks a grid. `section` and `labels` give `sections`, a jump per label with the one in view current, and `scrollTo(index)` brings an item to the top. The first `initial` items render on the server and until the first measurement (RULEBOOK 51.58-51.64, 51.95-51.97).
- 43bd209: `observe.visible` takes `once: true`: the first `true` it writes is the last, and the element stops being observed in the same delivery, so what the value gates renders the first time it is seen and stays mounted (RULEBOOK 32.100).
- c70418a: a `<name>.worker.ts` under `lib` runs each call to its exports in a thread started for that call — a `Worker` on a server and in an executable, a Web Worker in a browser — behind functions of the same name and type: an `async function*` streams a chunk per read, an `AbortSignal` argument aborts in the thread, and the app stopping ends the thread (RULEBOOK 55)

### Patch Changes

- edb7aae: fetchText reads Retry-After through #shared's retryAtOf ([`00e93c1`](https://github.com/briancray/abide/commit/00e93c1c22632b46362d2efd32efabbbe1ab11d1))
- edb7aae: one unlisten, one sendUnsub, settle owns the in-page step ([`091b734`](https://github.com/briancray/abide/commit/091b7347b559d951ff12d548dbdc1f5992f0b9b8))
- edb7aae: listbox, menu and tabs rove on one keyboard — 50.30, 51.4-51.6, 51.38, 51.39 ([`0b55163`](https://github.com/briancray/abide/commit/0b551637cfdb4fb314c05fcc12b04f8eecac63a5))
- edb7aae: the Disposer is the part's binding's — 32.83 ([`124b0e0`](https://github.com/briancray/abide/commit/124b0e05e0a0df70933b8ca5ba93371d03429849))
- edb7aae: in the native app, a conversation outside a request before the window's first runs as the window signed out, rather than refusing — 44.100 ([`1870c84`](https://github.com/briancray/abide/commit/1870c843687610e30ebd18bb7ef44162520488ce))
- edb7aae: renumber this branch's clauses after fix/tooltip-menu-gaps' — 50.41-50.45, 51.63, 52.34-52.39, 53.53-53.56 ([`203c0c4`](https://github.com/briancray/abide/commit/203c0c4101a950b38be60fdb47c5cdb2388d0f26))
- edb7aae: Cell.aborted leaves with its reader, one dropIfPast, cellOf at every cast ([`2315d02`](https://github.com/briancray/abide/commit/2315d02367a94c1647f79ad729cc38a4fc6210dd))
- edb7aae: track and pick read the pointer's x through one indexAt ([`2b586f2`](https://github.com/briancray/abide/commit/2b586f2e6f05262d03bc7335b65ea6b1b1e22af1))
- edb7aae: one unwrapped, one callReturnOf, isWriteTarget is classifyRead's two predicates ([`2d4f4d9`](https://github.com/briancray/abide/commit/2d4f4d93e460b154bb8a703cd950cfd0f15d89fc))
- edb7aae: a Chart's child and a Tooltips host join their list for as long as their setup stands — 52.24, 52.53, 50.36 ([`39278e1`](https://github.com/briancray/abide/commit/39278e195c5f65937b73354fd3f54c8c39f636b5))
- edb7aae: every 'is there code?' check is holdsStatement, the static return and the server's file bracket too — 41.6 ([`3bba7dd`](https://github.com/briancray/abide/commit/3bba7dd5ab8039aaf14ba5ceebbb1405d76908fa))
- edb7aae: calendar, carousel and the match runs name their elements under data-calendar, data-carousel, data-combobox and data-command-palette — 49.4 ([`3c8b0e9`](https://github.com/briancray/abide/commit/3c8b0e9187702a9778592c43529780d96f53e9ad))
- edb7aae: the clock's schedule finds the soonest and arms once; parsedJson at three more sites ([`3cfbbe2`](https://github.com/briancray/abide/commit/3cfbbe2f5fdb620f5e6fdbdd47be6e809a54ab96))
- edb7aae: one boundProperty and one BIND_ELEMENT leaf; leadingSpace lives with the scanner ([`3d0586a`](https://github.com/briancray/abide/commit/3d0586a0a5be7387fc66c38e3e8b31c5c749960e))
- edb7aae: one wordsOf and one parsedJson for a tool result's words and the JSON they spell ([`40b00f8`](https://github.com/briancray/abide/commit/40b00f8625625a365b387ed86da1c59906a7eed6))
- edb7aae: format the parts and listbox files main left unformatted ([`41ab4e0`](https://github.com/briancray/abide/commit/41ab4e08062d7c339dfc9de2eebe37070b5ca506))
- edb7aae: dropAtHeadTop owns its rewriter and depth, one asksPastCache, one ERROR frame ([`4341673`](https://github.com/briancray/abide/commit/4341673a9607b5996261da7c672f13daa0b1056f))
- edb7aae: the arrows that open a shut list are the ones it roves by, under menu and Combobox — 50.28, 51.14 ([`466666f`](https://github.com/briancray/abide/commit/466666f6107badb9e0de3b933d9b2a3cfaa8b25a))
- edb7aae: one module holds a popover against its anchor, under Tooltips and menu — 50.26, 50.27, 50.48 ([`4748179`](https://github.com/briancray/abide/commit/474817925179e17d04737e7604bfe9b352de3004))
- edb7aae: one HYDRATE_LOG for both lanes, one isPlainClick, RetryTimer, fillEmpty answers nothing ([`4896a79`](https://github.com/briancray/abide/commit/4896a79e0c00e53e090abb88f39ff872f2975d69))
- edb7aae: openApi paths from the one route grammar, fetchData's stream test is isValues, abide dev's worker runs this bun ([`66678c5`](https://github.com/briancray/abide/commit/66678c505ce94d2c7d558343460331e9ee27ebcb))
- edb7aae: format SortableTable's merged props ([`6d29f6b`](https://github.com/briancray/abide/commit/6d29f6bcb1b1edda359a0afce7046744ac188988))
- edb7aae: labelRuns escapes its needle itself, as RegExp.escape needs Safari 18.2 — and calendar joins the shared example classes ([`6da918a`](https://github.com/briancray/abide/commit/6da918af0aa1eec88e68e6ef8b24656d64fdaf66))
- edb7aae: a press passes over a layer outside is off for, rather than ending the walk down the stack — 53.15 ([`76d3aa3`](https://github.com/briancray/abide/commit/76d3aa375fdcb770e97e938d73ba219ffbda1438))
- edb7aae: the runtime exports List, as it does ArmRegion and Scope, and listAt goes ([`77c0883`](https://github.com/briancray/abide/commit/77c0883ecb39beedeaac5de3feab0b4712649cdd))
- edb7aae: one hydratedValue for every stand-in — 41.32 ([`7cecdfb`](https://github.com/briancray/abide/commit/7cecdfb1a41af69ebd2d2ae6261f15951ecbd586))
- edb7aae: a seed answers no call that carries a different value for a cookie its render read — a render made signed out answered the same browser's signed-in call for up to 30 s — 41.18 ([`7d0c2c3`](https://github.com/briancray/abide/commit/7d0c2c3dc4c2228b1192889c3b27cfba2649fb0a))
- edb7aae: a component mounts after what the body holds rather than over it, and its stop removes what it added — 38.119 ([`7d6a2b5`](https://github.com/briancray/abide/commit/7d6a2b5825336a724cc655883c53029ca66f8ef6))
- edb7aae: simpleShape derives plain and bareWrite as well as simple ([`88391ed`](https://github.com/briancray/abide/commit/88391ed22794b7ff5e5ca62131f59dab699a95e3))
- edb7aae: the last thrown-to-message spellings go through messageOf ([`886c6c9`](https://github.com/briancray/abide/commit/886c6c9e594fcbd4400d65fd17961f010021cb13))
- edb7aae: a button its own click disables hands focus on, in pages, wizard and stepper as in carousel — 49.15 ([`8bcda71`](https://github.com/briancray/abide/commit/8bcda7114501e1cb0eca1075beb1572fe1d59f3b))
- edb7aae: unexport file-local names, one subscribed(), settled asks busy once ([`90fa861`](https://github.com/briancray/abide/commit/90fa8610faff48fb09ff2eb8221180b6c0f60913))
- edb7aae: a fetchData that joins a stream in flight asks for its own ([`9162c81`](https://github.com/briancray/abide/commit/9162c81f5c8873b7bc9525f55b553ccc8ae6228b))
- edb7aae: isHydrating inlined, one visitorAgent, and the stale notes moved or dropped ([`938dca9`](https://github.com/briancray/abide/commit/938dca9fa1ebd32461103fa41932414f817e8fbc))
- edb7aae: one messageOf for what a thrown value says ([`9721860`](https://github.com/briancray/abide/commit/9721860b2d5defd530cdaff308e2bcfa3b36c790))
- edb7aae: parts read live through live.ts, stack is dismissible's own, a pie keeps the hints it drew ([`9b3718e`](https://github.com/briancray/abide/commit/9b3718e367420863e850351033ffee3a365b6e99))
- edb7aae: comments say how an aborted run is finished now, pairReactive reads cellOf, poll's delay is Live ([`b4cceb2`](https://github.com/briancray/abide/commit/b4cceb249417eab9573da419ee67e14b1dfed6a0))
- edb7aae: one LONGEST_DELAY, one messageOf, one keptIn, one present; isPipe gone ([`b54bd0b`](https://github.com/briancray/abide/commit/b54bd0b2f0b8890a98a9edc766b8399b4d14e8bc))
- edb7aae: one isAsyncIterable for both seams, and the scroller's view top and height beside offsetIn ([`badb737`](https://github.com/briancray/abide/commit/badb737ac5c441e17899fca02d0c63573802baeb))
- edb7aae: the dispatch order is armOf's, read by answerRequest and laneOf — 37.19 ([`c2c4560`](https://github.com/briancray/abide/commit/c2c456061933f2f6bade0058778fadcf1da4e0cf))
- edb7aae: dismissible's stack, the Tooltips standing and a chart's children register on one list — 50.36, 52.24, 52.53, 53.15 ([`c2f97fe`](https://github.com/briancray/abide/commit/c2f97fe8254da4731d715f0e9fc0f251a460a30c))
- edb7aae: the shared ResizeObserver goes with the last element it observes, so the next bind is made from the one standing then — 32.98 ([`c600cea`](https://github.com/briancray/abide/commit/c600ceaa50782ab9bc4f44a25c9cd9887061abd3))
- edb7aae: lastAtOrBefore is #shared, and segmentAt is its search ([`c8520fa`](https://github.com/briancray/abide/commit/c8520faf0261bb0ecf7f55e37ee02429c48e90a4))
- edb7aae: one bracket counter, one maker header, one blank-run rule, and the dead walks out ([`c92b71b`](https://github.com/briancray/abide/commit/c92b71bca415e681eca34c209d40008e5cb22708))
- edb7aae: fill says why it is not outlet.ts ([`cb8e855`](https://github.com/briancray/abide/commit/cb8e85503363ac153c1bc31c3d7d212c44a4cc92))
- edb7aae: virtualList.scrollTo lands a row through scrollSpy's offsetIn, lifted to scrollerOf ([`cd719ca`](https://github.com/briancray/abide/commit/cd719ca03b85d1544bc30974c04bcc0ab74b7092))
- edb7aae: prove each group's pages in the form that fits them ([`ce44bb0`](https://github.com/briancray/abide/commit/ce44bb0bd5d0441f95fdee4d1e6f6d925bf3c2b4))
- edb7aae: the app tree's build walk lives with the compiler that reads it ([`d0d9664`](https://github.com/briancray/abide/commit/d0d966421040c34399dec775f3987e7448bdc9f5))
- edb7aae: an arm's builder is written through buildFunction, the one maker header ([`da42a87`](https://github.com/briancray/abide/commit/da42a87e79cd95e42e6e77b33fcb36ead0284b46))
- edb7aae: a stop leaves nothing queued for the next app, and the send's deadline is tested — 36.23 ([`dd5735f`](https://github.com/briancray/abide/commit/dd5735f0527aa6d8c30fd24edac5d3af5b848bb4))
- edb7aae: the helpers the old overloads read a body through leave with them ([`dd69a08`](https://github.com/briancray/abide/commit/dd69a08a1c3f61b46f526ba93c3bda57250cfa57))
- edb7aae: a global production's Direct duration is timed from before the call — the call starts its body, so its work before the first await, and any pause before the clock was read, went uncounted; a loaded CI box read 35 ms for a 50 ms sleep — RULEBOOK 21.15 ([`de3e69c`](https://github.com/briancray/abide/commit/de3e69c48604af60e66b42c2c836269210e379a3))
- edb7aae: a test build keeps the four builds most recently asked for, and sweeps on reuse as well as after a build — 42.22 ([`deeebd4`](https://github.com/briancray/abide/commit/deeebd47a690c1c882a6dd6596e23e5571e8cd02))
- edb7aae: one nextTask, a leaf both the reactive core and takeEarlyCall post through ([`e22b045`](https://github.com/briancray/abide/commit/e22b04543d7b595c82b3de45025cb4f3ff7a1fa4))
- edb7aae: routedLane takes a route not found too, and the webkit skip says any budget ([`e61d862`](https://github.com/briancray/abide/commit/e61d862b910c8a33e0d64eee2c16084ea94097a4))
- edb7aae: a route.query write in the same turn as another builds on the address the first is navigating to, and reads see it — 30.44, 30.45, 30.48 ([`e69335a`](https://github.com/briancray/abide/commit/e69335a369ad6ac97729c8112bb50a0666690f80))
- edb7aae: one closerOf for a matching close, and readsLive says its own rule ([`e96d1c7`](https://github.com/briancray/abide/commit/e96d1c7c3029e693d20ebde273999b0cba6cf243))
- edb7aae: an element's bind refusals and 33.16 are the parser's, once per element ([`e97de35`](https://github.com/briancray/abide/commit/e97de35620d09cf92277c9f48b43f4aad20bacfa))
- edb7aae: a bare probe is found by its tokens, so the words "ready()" in text defer nothing — 41.28 ([`ed7f7b0`](https://github.com/briancray/abide/commit/ed7f7b02d0396656029afa2dad0ebb48426dfd24))
- edb7aae: the request path's and the desktop's small duplicates and dead exports ([`f89f9e1`](https://github.com/briancray/abide/commit/f89f9e1ed00910e5bfefb3942ff3a710e5dbe7f3))
- edb7aae: unlandable lowers its own holder, toMemo reports nothing it never read ([`fd41db4`](https://github.com/briancray/abide/commit/fd41db4129195680bd754e081c7f395d5cd6cc4d))
- 8ca9c80: A `carousel`'s `previous` or `next` that its own click disables hands focus to the other button rather than dropping it to the page (53.91). In a `lightbox`, clicking to the last item had left the arrow keys unheard, since focus fell outside its dialog.
- b957991: A `carousel` bound with no box — inside a closed `dialog`, a hidden panel — scrolls to the item it rests on the moment it gets one, and again each time it is shown (53.62, 53.63). A `lightbox` opened on an item had stayed on the first, with `next` disabled, and reopening on the same item left it wherever it was closed. Its scrolls now go to an offset rather than by one, so in WebKit a second click of `previous` or `next` while the first is still scrolling lands centered rather than ~26px short.
- 98ce987: A `menu` item whose own `onclick` disables it now closes the menu: the pick is read as the click is captured on the menu, before the item's handler runs (RULEBOOK 50.31). And in development, `menu`, `popover`, `combobox`, `tooltip.host` and `chart` warn on `abide:parts` when a popover among their parts is drawn while closed, which is what an app's `display` does by outranking the browser's hiding of a closed popover (RULEBOOK 49.14).
- cebd12a: a `Combobox` with its list shut and its input empty leaves Escape alone, so a `<dialog>` holding it cancels as it should rather than every Escape being prevented (RULEBOOK 51.28)
- 11610e3: A press on a `combobox`'s field opens its list, listing every option, and a second press shuts it, as a press on a `menu`'s trigger does; a `search` combobox opens on a press once its field holds text. Focus arriving by Tab still opens nothing. Alt+ArrowDown opens the list and Alt+ArrowUp shuts it, without stepping the active option (RULEBOOK 51.92, 51.93, 51.14).
- 412de91: `pairing`'s `copyInstall` copies on a page served over plain http, through the selected textarea `copy` already falls back to (RULEBOOK 44.72, 53.22).
- d0cb7e5: A `Dialog` shut in code and opened again before the browser reported the close stays open: the late `close` no longer writes `false` to `open` (RULEBOOK 50.2).
- a37eef7: a global production's `Direct` duration is timed from before the call, so the body's work before its first await is counted (RULEBOOK 21.15)
- cc5fc47: A paste carrying its files in `items` alone reaches `dropzone`'s `onreject` with the files it turns away, as a drop does (RULEBOOK 53.45).
- da5222f: A refusal `fetchText`, `fetchJson` or `handle` hands back keeps the service's `Retry-After`: a handler returning it answers with the same header, and a value it refused is held until then (RULEBOOK 15.23, 15.24).
- 803910d: An open hint is the top layer of `dismissible`'s stack, so an Escape closes the hint alone and is prevented: the panel or the `<dialog>` under it stays open for the next Escape, where before one Escape closed both. A hint now also yields an Escape a focused field already took (RULEBOOK 50.25, 53.15).
- 595114d: A component whose `<script>` holds only imports no longer pays for a setup on every mount: the client opens no `Scope` and no `try` for it, and the server renders it once rather than counting its calls (RULEBOOK 41.6).
- 35046a5: A pointer moving over a `listbox` option makes it active without moving to it: it stays active until the listbox next moves to a key or `selected` is written, and a single-select `aria-selected` names the key moved to rather than the option under the pointer (RULEBOOK 51.1, 51.94).
- 496a571: A shipped component's props reach its parts live, as RULEBOOK 33.5 asks: `Range`'s `labels`, `format` and `name`, `CommandPalette`'s `hotkey` and `label`, `Combobox`'s `search`, `key` and `label`, and `Chart`'s and `Pie`'s formats, `onpick` and `disabled` were read once at setup, so a prop that changed or arrived after mount never applied. The headless components read those options as they use them, so an app handing its own options as accessors gets the same. An `id`, a `debounce` and whether a `Combobox` picks many stay fixed for the life of the parts.
- a88603d: `Markdown` renders a closed fenced block its `blocks` names as that component when it ends the source, not only once more text follows it, and keeps the block's nodes when text does follow (RULEBOOK 52.43, 52.18).
- fe9eded: A `MenuItem`'s `key` spells an arrow as `arrowup`, `arrowdown`, `arrowleft` or `arrowright` in the native menu bar too, the spelling a page's `hotkeys` matches and `keyLabel` writes, so one key works in both (RULEBOOK 38.213).
- b53c025: ArrowUp in a `menu` with no item focused moves focus to the last item rather than the one before it (RULEBOOK 50.30).
- 703fe4e: A native `MenuItem`'s `key` is read by the same parser as `hotkeys` and `keyLabel`: `mod++` binds the plus key, and a modifier that is not one of the five or a spelling of one throws instead of being dropped (RULEBOOK 53.9).
- a883c04: A native app reads its update feed by the wall clock rather than a timer a sleeping Mac stops, again when the Mac wakes or the app comes to the front, a minute after a feed it could not reach (backing off to the hour), and on after an update is staged, so a newer release replaces the staged one; every read logs one line naming what it found (RULEBOOK 38.142)
- eb242df: `Toasts` and `Prompts` show in the last of each standing, as `Tooltips` already did: a second one a nested layout renders shows nothing, rather than every notice twice or a second modal over the first. A notice or a prompt asked for with none rendered now warns once on `abide:toasts` or `abide:prompts`, as a hint does on `abide:tooltip`, rather than being lost without a word (RULEBOOK 50.36).
- 6d79558: `observe.size`, `observe.rect` and the placement of an open hint or menu share one `ResizeObserver`, where they made one each: a frame in which several resize is one batch of deliveries (RULEBOOK 32.81, 32.98).
- 3e044d8: The OTLP exporter's 4,096-record bound now holds while a collector is slow: one send is out at a time and what waits for it stays in the bounded queue, where before each batch was chained behind the last and none were dropped. A send the collector has not answered in 10 seconds is given up, so a hung collector no longer holds a stop (RULEBOOK 36.23).
- ae73e4b: `pages`' `items` hold the same number of entries whatever `page` is — every page where there are no more than `2 × around + 5`, and else exactly that many, the run reaching an end rather than leaving a short gap — so the links do not shift as the page moves (RULEBOOK 51.125).
- 04224da: `tabs`, `menu`, `listbox`, `tree` and `form` check the markup their parts are spread on while developing: an `aria-controls`, `aria-labelledby`, `aria-describedby`, `aria-activedescendant` or `aria-owns` naming an element that is not there, and a tab, option, tree item or menu item outside the list it belongs in, each warn once on `abide:parts`. A build carries none of it (RULEBOOK 49.7).
  
  What the check found is fixed: a tab names its panel by `aria-controls` only while it is selected, so the tabs sharing one panel no longer name panels that are not there (51.40), and `Combobox`'s input names its list only while the list is open.
- 4fab77c: A derived value that reads only a probe (`memo(() => x.busy() ? … : …)`) now wakes a guard over its own `busy()` / `ready()` when that probe moves, and its `debounce` / `throttle` holds the run the move marks — the probe walk reaches it as a value's change does (RULEBOOK 3.2, 5.11).
- 8899e79: A `ReportDraft` and a mutation queued in `outbox` are minted their ids on a page served over plain http, where `crypto.randomUUID` is missing (RULEBOOK 48.12, 46.10).
- 3e8330c: Fewer overloads, same inference: `reactive` has three signatures where it had ten — a value, a body, and nothing written yet — and `GET`, `POST`, `PUT`, `PATCH` and `DELETE` three where they had nine — a body, a `Reactive` or `Keyed` already built, and a value. A body's key, its stream and what it adopts are read off the body by one signature. One call types differently: `reactive<T[]>(() => …)` types its value as `T[]` where it read a stream of `T[]` chunks.
- 54bc3f4: `readOnly({ allow })` lets a write through to an allowed handler when the app is served under a sub-path too; it used to refuse every write there (RULEBOOK 54.6).
- d1a23d1: `requireRole(…, { status: 404 })` under a sub-path names the same path an address nothing serves does, below the mount, so the two stay indistinguishable (RULEBOOK 54.28).
- b8d8639: `fetchJson` and `fetchText` wait out a retry by the same rule the outbox and the socket mux do: the step doubled from 250 milliseconds, or the answer's `Retry-After` where that is later. A `Retry-After` sooner than the step no longer shortens the wait (RULEBOOK 54.10).
- 182b478: an `{#if}` arm or a `{#for}` row inside the children passed to a component finds the `reactive.share` that component holds in the browser, as it already did on the server, rather than filling a value of its caller's own on hydration and on every reopening (RULEBOOK 10.5)
- c0bb153: A prop written as a shorthand member where the parameter declares that member a `Reactive` hands over the prop's `Reactive`, as the longhand does: `chat({ turns })` binds the caller's conversation rather than passing the array (RULEBOOK 33.27, 31.3).
- 63de031: A mux socket frame that is not a JSON object (`null`), or names an address that is not text, is dropped rather than thrown in a handler nobody awaits — which stopped the app (RULEBOOK 37.10). And a `time` label a month or more from its next change no longer arms a wait past the longest `setTimeout` holds, which fired at once and ticked every few milliseconds.
- 9f9ff82: `sortRows`, and so `SortableTable`, compares text in the `en-US` locale `format` writes in, rather than the runtime's, so rows a server sorted keep their order once the page hydrates (RULEBOOK 51.46).
- 1d51834: `stepper` takes a number as it is typed, once the text already stands within its bounds and on its step (RULEBOOK 56.33); a change still keeps anything else to them.
- 2329862: An early call of a streaming `GET` whose handler writes a cookie or signs someone in or out through `cookies()` or `principal` is answered whole over http, as RULEBOOK 16.97 says. Before, the check read only the headers on the answer the handler built, so such a call was still handed to the socket mux and its rest parked under the caller as it was.
- 6a0ea03: The language server's template completions read a slot's end as the parser does, so a `{` inside a comment, a regex or a template string no longer stops completions for the rest of the file (RULEBOOK 38.117).
- 50bdc85: A list of `time` parts mounts and unmounts in time linear in its length: a label arriving weighs only its own next change against the clock's one timer, and a list leaving reschedules once at the end of the turn rather than once a row (4,000 labels: 190 ms to mount, now under 1 ms).
- 0e990d2: a `Tooltip` opens at once only for focus the browser shows (`:focus-visible`), so a mouse click on its anchor no longer opens the hint and holds it open while the anchor keeps focus — the pointer's hover delay still applies (RULEBOOK 50.24)
- b74b746: `TooltipOptions` takes every placement option `popover` does, `margin` among them, so a hint can keep its own distance from the window's edges; only `side` keeps its own default, `'top'` (RULEBOOK 50.19-50.21).
- bf5d145: A `Tooltips` is never the target of the pointer, so a hint open over its anchor no longer takes the pointer from it: a chart's readout opening under the pointer stopped flickering open and closed as the pointer moved (RULEBOOK 50.47, 49.5).
- 84115cd: `observe.visible`'s shared viewport observer is disconnected with the last element it observes, as every other shared observer is, and the next bind makes one from the `IntersectionObserver` standing then (RULEBOOK 32.98).
- Updated dependencies [9206ce8]
- Updated dependencies [edb7aae]
- Updated dependencies [edb7aae]
- Updated dependencies [edb7aae]
- Updated dependencies [edb7aae]
- Updated dependencies [edb7aae]
- Updated dependencies [5c6d6da]
  - @abide/bridge@0.9.0

## 0.142.0

### Minor Changes

- f858700: guards, resilient fetches and scheduled jobs in @abide/abide/server ([`1447e2f`](https://github.com/briancray/abide/commit/1447e2fa40d67d03c7a6217e51b751fe5f5764c0))
- f858700: Dialog, Prompts, Toasts, Tooltip, Menu and the prompts, toasts and place helpers in core ([`3a04d07`](https://github.com/briancray/abide/commit/3a04d077c19d7c5e2ba12b09ec38fa163941bfb1))
- f858700: format, markdown and chart helpers, and the Markdown, LineChart and Sparkline components ([`59e407d`](https://github.com/briancray/abide/commit/59e407da96f97a732d7d685442756a65877763e0))
- f858700: listbox, Combobox, Tabs, SortableTable and sortRows in core ([`69fd6c9`](https://github.com/briancray/abide/commit/69fd6c9e840cd446d60d21dd6a326258deba146b))
- f858700: hotkeys, element behaviors, the transcript fold, Chat and Pairing in abide core ([`90760be`](https://github.com/briancray/abide/commit/90760bea1b59e5ca2becddf191d25bd81b833425))
- 6997b4d: `abide check` reports on every file the app's `tsconfig.json` includes inside the app's package — its tests, scripts and browser specs as well as `src` — and on nothing inside a package nested in it (RULEBOOK 38.209, 38.210). `bun check` runs an app's `check` script in place of `tsc`, so those files were checked by nothing
- 6337033: a `.abide` exports by name what its `<script module>` exports, beside its component — to a page and a `.ts`, on a server and in the browser, and typed by `abide check` (RULEBOOK 34.33). `export default` and re-exports stay refused there (34.34, 34.35), and a `<script>` or `<script server>` still exports nothing (34.17)
- 89fb91f: `prompts.prompt` asks for a line of text in the app's `Prompts`, settling with what was typed or `undefined`. `PromptOptions` gains `value` and `placeholder`.
- a42b597: abide ships headless components and the helpers beside them. Components, each its own entry (`@abide/abide/<Name>.abide`): `Dialog`, `Prompts`, `Toasts`, `Tooltip`, `Menu`, `Combobox`, `Tabs`, `SortableTable`, `Markdown`, `LineChart`, `Sparkline`, `Chat`, `Pairing` — no stylesheet, styled by the `data-` attributes and `data-part`s they write (RULEBOOK 49). `prompts` and `toasts` come from their components' own entries (`import Toasts, { toasts } from '@abide/abide/Toasts.abide'`). From `@abide/abide`: `format`, `markdown`, `chart`, `place`, `listbox`, `sortRows`, `hotkeys`, `keyLabel`, `isEditableTarget`, `dismissible`, `dropzone`, `copyText`, `transcript`. From `@abide/abide/server`: `signedIn`, `requireRole`, `readOnly`, `fetchJson`, `fetchText`, `job`

### Patch Changes

- f858700: RULEBOOK 52, the format, markdown and chart registry rows, and their pages ([`a4218a1`](https://github.com/briancray/abide/commit/a4218a16a3d6ec98f813b0acf16ba40c43f167eb))
- f858700: name what Chat and Pairing write for a caller to style ([`f75fac2`](https://github.com/briancray/abide/commit/f75fac28b8b70838c9449d98d3e0213aafe7d3ac))
- e3b6c23: `Chat`'s `Text` render prop takes an inline `{#component Text(…)}` the way `Combobox`'s `Option`, `Tabs`' `Tab` and `SortableTable`'s `Cell` do: it was typed to return a `Component`, so the spelling its own docs showed did not compile (RULEBOOK 53.39)
- 8267683: `abide check` names a file that `declare module`s an `@abide/` entry while importing and exporting nothing: such a file replaces the module for the whole program, and every import of it read as missing with nothing pointing at the cause (RULEBOOK 38.212)
- cc1c697: a package's `.abide` component is held to its props where an app imports it: through an explicit `exports` entry, and through a workspace link (RULEBOOK 34.25)
- 9ead0c8: `abide run` imports a `.abide` file as the app compiles it — the build of its sources as they stand, which `bun test` shares — so a script can `render` a component (RULEBOOK 38.211)
- 699a533: a `GET` or `DELETE` arg that is a record, or a list holding a record or a list, rides the URL as its canonical JSON rather than `[object Object]` — so two different records are two addresses and two cache entries — and the server reads it back where the schema declares one (RULEBOOK 30.28, 19.27). A list of primitives is still its member repeated

## 0.141.0

### Minor Changes

- 2fad7a5: a draft carries an idempotent id, and send() settles to it ([`65f23c0`](https://github.com/briancray/abide/commit/65f23c08a5c9e7f0dc3837bc5df32141865815e8))

## 0.140.1

### Patch Changes

- 36a7b18: The native app's notification permission request now asks for the badge too, so `navigator.setAppBadge` is drawn on the Dock once the person allows notifications (RULEBOOK 38.188, 38.190).

## 0.140.0

### Minor Changes

- a1b5f34: `abide upgrade [--check] [--from <version>]` applies the migrations keyed to each release after `--from` to your app's own files and prints every change as a diff; `--check` prints it, writes nothing and fails where a file would change (RULEBOOK 38.198-38.201). The first migration, keyed to this release, removes from `AGENTS.md` every paragraph an earlier `abide scaffold` wrote or `ABIDE.md` holds word for word, drops a heading left empty, and puts the pointer to `ABIDE.md` under the title (38.202, 38.203). `abide check` now warns at each such paragraph (38.196, 38.197). A change to a `store`'s key or JSON, or to the shape of a request an `Rpc` sends, now reads the old form until the next minor release (8.43, 16.106).
- a direct component call takes a bound prop as its Reactive — 38.195, 38.196 ([`1349b4f`](https://github.com/briancray/abide/commit/1349b4f2cf1a50dceb268008a2f054cc32e98cb2))
- {:pending} arm on {#try} for a body's first load, and a warning on a {#for} subject falling back to [] — 32.16, 32.56, 32.96, 32.97 ([`ee08338`](https://github.com/briancray/abide/commit/ee083384cef2799cbb3a1656013ecf4d7ac9b3ef))
- <window> and <document> listeners, and on<event> listener objects carry their options — 32.95, 39.21-39.23 ([`f15edbb`](https://github.com/briancray/abide/commit/f15edbb5d0f3a0f6370bfb68389a29af15480393))
- 7648980: `database()`'s opener carries `changed`, a `Reactive<number>` that increases when another connection — another process, or another connection in this one — commits to the file. It asks `PRAGMA data_version` once a second, only while something reads it, and never opens the file itself. Follow it with `watch(() => { db.changed(); refresh() })` to reload every value something reads. RULEBOOK 47.22, 47.23, 47.24.
- 82b2282: `assistant` runs in the run of a `global` value — a `GET` declaring `global` that streams one answer to every reader. No request owns that run, so its provider's signal aborts when the app stops (`stopSignal`) or the caller's `signal` does, not when the first reader leaves; it carries no asker's credentials, and asking it for tools (`mcp`) throws. Outside a request elsewhere the same holds, where it used to throw. A conversation run as the native app's window ends when the app stops too. RULEBOOK 44.57, 44.100, 44.101.
- 5622f70: A test waits on `await settled()` from `@abide/harness/abide` (or `@abide/abide/test`) in place of `Bun.sleep` and a `flushSync()` loop: it resolves once no value is loading and no effect is pending, and past its `timeout` (2000 ms by default) it throws naming each value still loading, a handler's call by its method and address. Loads are kept for it only in a process that loaded `@abide/abide/test`. RULEBOOK 38.204, 38.205, 38.206.
  
  `atMost(work, { wakes: 9, nodesCreated: 0 })` from `@abide/harness/gate` asserts ceilings on a work record, failing at the caller's line with every field over its ceiling and what it reported, and on a ceiling over a field the record carries as absent — an app's test holds the most it allows rather than an exact count of abide's internals. RULEBOOK 43.40, 43.41, 43.42.
  
  The `@abide/harness/preload` DOM takes the `File` and `Blob` a test builds — `DataTransfer`, `<input type="file">`, `FileReader` and `URL.createObjectURL` accept them, and they still go over the wire as bun's — `new FormData(form)` carries the form's fields and files, and an `iframe` loads no page. RULEBOOK 43.28, 43.37, 43.38, 43.39.
- 62850ba: A refusal at 408, 425 or 429 is transient as one at 500 and above is: a `Keyed` entry or an `Rpc` runs its body again on the next reach rather than holding it for its `ttl`, so a rate limit no longer has to be rewritten as a 503. A `Retry-After` on such an answer, in seconds or as an HTTP date, holds the refusal until the time it names, and crosses the wire again with the refusal wherever it is answered on. The outbox keeps a call answered 408, 425 or 429 and waits at least its `Retry-After` before sending it again, the offline worker keeps its copy under one, and `abide call` exits 8 for one. A handler body refusing synchronously no longer runs twice per call. RULEBOOK 15.19, 15.20, 15.23, 15.24, 45.26, 45.29, 46.4, 46.21.
- 0feb662: - `<window>` and `<document>` take `on<event>` listeners at a file's top level: added on mount, removed when the component leaves, never run on the server (RULEBOOK 39.21-39.23)
  - an `on<event>` value may be an `EventListenerObject` — `{ handleEvent, passive: false }` — whose `capture`, `once`, `passive` and `signal` are the listener's options, written or spread (32.95)
  - `{#try}…{:pending}…{/try}` renders the pending arm while the body's first load is out, and never again on a reload (32.16, 32.96)
  - `abide check` warns on a `{#for}` subject written as `x.ready() ? x : []`, `x || []` or `x ?? []` (32.97)
  - a component called directly — `mount(Picker({ job }))` — takes a prop as a `Reactive`, typed and bound as a `bind:` would hand it over (38.207, 38.208)

### Patch Changes

- 86c7508: who asks of a pairing is built in one place ([`08fef67`](https://github.com/briancray/abide/commit/08fef67877d4e9c73f41b69b3769819543cce795))
- 86c7508: what round 1 left — flagOf takes objects, one Asker, one secrets loop ([`1296961`](https://github.com/briancray/abide/commit/12969619a0509365dc18d00a53b1594523eb11ef))
- 86c7508: a run of proven parts builds and writes as text alone ([`1a48453`](https://github.com/briancray/abide/commit/1a48453ee1c48768ce9679fa724b2cb090c47292))
- 86c7508: a block keyword spelled outside ASCII is refused by 32.65, not misread ([`1a63dc1`](https://github.com/briancray/abide/commit/1a63dc11fd9185b2e0595b5d01ab26ec01330816))
- 86c7508: one reader of a schema's JSON Schema, one of the app's identity ([`207d52b`](https://github.com/briancray/abide/commit/207d52bdd4eb3474428987cac7e504eeb04bf1df))
- 86c7508: bridgeRelay imports the grant module rather than copying from it ([`49c1b94`](https://github.com/briancray/abide/commit/49c1b94759e6798302009bac415a89939801002b))
- a tag stays held to its props as declared; only a .ts importer's direct call takes a Reactive — 38.196 ([`4e281cd`](https://github.com/briancray/abide/commit/4e281cd02f87e1572bec0ab93cfb3fc85acd7e5e))
- 86c7508: the layout reads each file's imports once ([`6907a17`](https://github.com/briancray/abide/commit/6907a17f8a9b45a3c84bdf502189cddaf2e05bbf))
- 86c7508: one spelling each of a pair setter, a BOOL getter and a script handler ([`78ffb81`](https://github.com/briancray/abide/commit/78ffb81ea4d80bb5d15549e085ae0a746ffb4f8b))
- 86c7508: an inline component's prop narrows under {#if} ([`79f4e31`](https://github.com/briancray/abide/commit/79f4e31d151d71cc5a1643c8c6f6f3b953a4651c))
- 86c7508: an online, offline or media change while a page hydrates waits for it to end ([`95c6ade`](https://github.com/briancray/abide/commit/95c6ade4ddd4d6b0cc53119a94da58df05a5ed7e))
- 86c7508: pendingUpdate is a hydration stand-in, and report reuses log's and seededDocument's spellings ([`b0c73a1`](https://github.com/briancray/abide/commit/b0c73a1f7d5f6f4dfe8ab28bfc0fca247584c636))
- 86c7508: a name test is IDENTIFIER_PART's, so `$busy()` defers and `{#ifé}` is refused ([`b88d48f`](https://github.com/briancray/abide/commit/b88d48fd60af6486ed6215a093ca9148a8dee8f3))
- 86c7508: each secret of a rotated ABIDE_PRINCIPAL_SECRET is redacted ([`b8ec6be`](https://github.com/briancray/abide/commit/b8ec6be39ae6c6804e0b526dfbb6277796b5ad16))
- 86c7508: one isPlainData, and poll's settle timer armed through armTimer ([`bdd4ae7`](https://github.com/briancray/abide/commit/bdd4ae73be30e53f10cb9d5307c3d148636a6ef6))
- format the merged {#try} arm test ([`d834b30`](https://github.com/briancray/abide/commit/d834b3019ea3f699f825d50b73d2008a7b1285da))
- 86c7508: what round 1 left — RegExp.escape, closeTagAt in componentsIn, stale componentGraph notes ([`e9cf571`](https://github.com/briancray/abide/commit/e9cf57116f71a57d88ad42da579a93b20c699559))
- 86c7508: a route followed in place arrives through arriveAt ([`f96ba4e`](https://github.com/briancray/abide/commit/f96ba4e27b9d894099c52538ff6c208d5e70a4af))
- Updated dependencies [86c7508]
  - @abide/bridge@0.8.3

## 0.139.0

### Minor Changes

- b649a8e: In the native app, `assistant` called outside a request — from a timer or `onStart` — runs as the window's latest request: its principal, its caller and its credential, so `provider.claudeCode` runs on the app's own Claude Code and the app's tools answer as the window's person. Outside the native app, or before the window has asked anything, it still throws. RULEBOOK 44.100.

## 0.138.0

### Minor Changes

- db7cecb: The native app's window and menu bar extra panel give every page `navigator.setAppBadge` and `navigator.clearAppBadge`, drawing the badge on the Dock icon (RULEBOOK 38.188)
- aa0d08d: The native app's window answers more of the web platform: `print` opens the print panel, `download` links and attachments save to Downloads, file inputs open the open panel, `prompt` asks in a sheet, `requestFullscreen` works, `Notification` shows macOS notifications, and the `.app` declares camera, microphone and location use so `getUserMedia` and `geolocation` are available (RULEBOOK 38.178, 38.189–38.194)
- 4792db8: OpenTelemetry export over the standard variables. With `OTEL_EXPORTER_OTLP_ENDPOINT` (or a signal's own endpoint) set, every line the app logs is sent as an OTLP log record and every span as an OTLP span — each request the root span of its trace, under the id `traceresponse` names — as OTLP/HTTP JSON, batched each second, carrying `OTEL_EXPORTER_OTLP_HEADERS` and named by `OTEL_SERVICE_NAME` or `APP_NAME`. Unset, nothing is sent; `OTEL_SDK_DISABLED=true` turns it off. RULEBOOK 36.19-36.23.
- 155e23e: Problem reports. `report({ trace })` drafts one — the page's own log lines, and in the native app's window the server's for that trace — and `ReportDraft.open()` shows it in abide's own dialog, every word that will be sent above the Send button; an app drawing its own binds `summary` and `description` and shows `markdown`. `send()` hands the `Report` to every `onReport` the server files, which decides where reports go, with the principal secret and every password config field taken out. RULEBOOK 48.
  
  `ReportDraft.open()` settles `true` once the draft is sent and `false` once it is closed unsent, so a page can refresh what a report changes.
- cb76b5b: `onRefusal`'s `call` carries `trace`, the trace id the refused answer's `traceresponse` named, so a page can point a person, a log or a report at the request that failed (RULEBOOK 37.24).
- a23fbda: A span's `LogRecord` carries `span`: its own id, the span it opened under, its name, kind, duration, status and attributes, so the lines of one trace form a tree (RULEBOOK 24.9). With `DEBUG=abide:request` each request is written as the root `server` span, under the id `traceresponse` names and the caller's `traceparent` (24.10).

## 0.137.0

### Minor Changes

- bce9218: native() answers the name the app's menu bar shows, beside its version ([`3519ee8`](https://github.com/briancray/abide/commit/3519ee83a379ddc93c059076561b3a39664e6bbb))
- bce9218: onLauncher's start: 'immediately', and a menu named for the app grows the application menu below About ([`bc1bbaa`](https://github.com/briancray/abide/commit/bc1bbaa6f7964868a4224aa31998672ac088dc43))
- bce9218: a native app opened from the Finder writes what it prints to ~/Library/Logs ([`bf7a0eb`](https://github.com/briancray/abide/commit/bf7a0ebb5931b0e5c28b1510bfd27445fc403735))

## 0.136.1

### Patch Changes

- d8fef91: one windowHandler(name) for the native window's channels; log's info and debug share one gate ([`4afdea2`](https://github.com/briancray/abide/commit/4afdea24229222cb76e5f062ccf28343ae8674ab))
- d8fef91: one forwardingPrototype for a follow-up and a server's forwarder ([`70d1800`](https://github.com/briancray/abide/commit/70d180019343846261b4cbd79dd19c42d884245f))
- d8fef91: seedBuffer holds its scope through holdScope; one receivedAsUpgrade; Bun.concatArrayBuffers for a handoff's leftover ([`83eef91`](https://github.com/briancray/abide/commit/83eef91cf77e2c51675ac8b26a51f27e9db4b53b))
- d8fef91: one IndexedDB promisifier; MuxStream.fail goes; wire's entry cast written once; escapeless is a barrel re-export ([`9f50e50`](https://github.com/briancray/abide/commit/9f50e5032e26f4eebfd350d81cb77a37a75ee6fc))
- d8fef91: sendFlag/sendNumber for a one-scalar send; one isRunning; spawnedTool through updateFeed's ran ([`dceff54`](https://github.com/briancray/abide/commit/dceff54a4c90a25287642b6e071e13168bf925d5))
- d8fef91: every identifier test is built from IDENTIFIER_PART; holdsSlot's pass-through goes; indexedDB opens through requested ([`e60f532`](https://github.com/briancray/abide/commit/e60f5321a4b33ef5588aed9f02052dbfb02159e0))
- d8fef91: the last one-scalar sends through sendFlag/sendNumber; windowButton in appKit; ran in its own file ([`e9e6611`](https://github.com/briancray/abide/commit/e9e66118aacebfff8b0c97a95802fbd5498b49b4))
- d8fef91: one early-exit tree search, one spread test, one inline-component prelude ([`f00effe`](https://github.com/briancray/abide/commit/f00effed6a6c680b474cc600f0ac244eaaa32752))
- b78c6c7: The menu bar extra's panel is never open to Web Inspector: the inspector took the key the panel closes on losing, and the two flickered in a loop. Its page is inspected in the window — RULEBOOK 38.163
- 68c4298: A top-level `onConfig(…)` on the line after one ending in a name spelled outside ASCII is read as the top-level call it is — RULEBOOK 38.108
- 647585f: A `bind:` path whose step is an identifier spelled outside ASCII (`bind:{contact.ñame}`) writes the path, rather than reading as a plain value; a list row's name and the language server's underline read such a name whole — RULEBOOK 32.5
- Updated dependencies [d8fef91]
  - @abide/bridge@0.8.2

## 0.136.0

### Minor Changes

- 5d423e0: callTool makes a call the bridge could not by a turn — an older bridge, or a server it cannot start or reach, such as one signed in through Claude Code: Haiku, granted that tool alone, its prompt for the tool allowed, the tool's own answer returned and the run ended the moment it answers — RULEBOOK 44.99 ([`8ad99bd`](https://github.com/briancray/abide/commit/8ad99bdae1936ce2907cfa250deec64a063c02b7))

### Patch Changes

- e5b48ef: a call of one MCP tool is made under the grant alone — no --allowedTools past it, since a turn's prompt is the site's to answer (44.83) and a call is already the site's own choice of tool and input; --disallowedTools still refuses — RULEBOOK 44.94 ([`ac0c77c`](https://github.com/briancray/abide/commit/ac0c77ceae8789bb726ba3aa41de8c2971cc19db))
- Updated dependencies [e5b48ef]
  - @abide/bridge@0.8.1

## 0.135.0

### Minor Changes

- 0d00892: `provider.claudeCode.callTool(tool, input)` calls one MCP tool of the visitor's machine through the paired bridge with no model — no turn, no tokens, as long as the tool takes — and answers a `ToolAnswer`. A call is held to the grant a turn naming that tool alone would have, and runs only where the visitor's `--allowedTools` approves it; anything else is refused 403, and a bridge from before calls is refused 409 (RULEBOOK 44.93-44.98)
- c9b22c5: `abide native` names the app by its `APP_NAME` where an `onConfig` default or the environment it runs in sets one — the bundle's name and display name, the `.app`, the menu bar, the window and `Launch.name` — and keeps the `package.json` name for the executable and the bundle identifier, so the app's remembered state and settings stay where they were (RULEBOOK 38.78, 38.87). The name is read when `abide native` runs, before any `onConfig` schema, which may require what only the start form supplies
- ecde642: `onLauncher` takes `dock: 'window'` beside `menuBarExtra: true`: the Dock icon and the menu bar come and go with the window, and Quit in the application menu closes the window and leaves the app in the menu bar, where the menu bar extra's own Quit still stops it through `App.stop` (RULEBOOK 38.183-38.185). An `onLauncher` refusal names the clause it breaks rather than always 38.81
- 375b2c9: a native launcher with `connect: false` whose start form asks for nothing starts the app at launch rather than showing a lone Start button (RULEBOOK 38.182), and the start a launch makes forgets a remembered value the app has since come to offer, as any start does (38.73) — so a copy that remembered a value before its app made it the default follows the default from then on

### Patch Changes

- 319a1ae: `abide check` refuses a property an imported or local reactive's `set` does not take in an object literal written to it by name (`question = { text, stale: 1 }`), as TypeScript does for an assignment — RULEBOOK 31.18. A whole value of the wrong type written by name is now reported as TS1360 at the value rather than TS2345.
- Updated dependencies [0d00892]
  - @abide/bridge@0.8.0

## 0.134.1

### Patch Changes

- e24354b: the native app finds claude on the login shell's PATH when opened from the Finder — Bun.which and Bun.spawn read the PATH the process started with, so localStands passes the current PATH and a turn's spawn hands the child the current env; the 44.77 test now starts with no claude on PATH and assigns it after, as runNative does ([`26a24cb`](https://github.com/briancray/abide/commit/26a24cbd98ebc248dce33a17fb0f5a28521247d4))
- af5a883: the executable abide compile and abide native write trusts this machine's certificate authorities as well as bun's — started with --use-system-ca, so a native app opened from the Finder reaches an update feed an organization's authority signed (RULEBOOK 38.181) ([`9bcbafc`](https://github.com/briancray/abide/commit/9bcbafc7cec86377c0928658d0c83e9e0b44b326))
- Updated dependencies [e24354b]
  - @abide/bridge@0.7.4

## 0.134.0

### Minor Changes

- 4921bc9: the app goes on answering while the window is resized, a menu is held open or a sheet is shown, and the window no longer wakes while nothing reaches it — the main thread sleeps in AppKit's own wait instead of polling it every 8 ms, and the app, the launcher, the session and the updater run on a worker that wakes it by Mach message ([`60784f6`](https://github.com/briancray/abide/commit/60784f678d77e216fd00f3cc6e1f7d582862396f))
- 4921bc9: alert, confirm and the update check are sheets, so the app goes on answering while one is open — the event drain lets go of what AppKit autoreleased each pass instead of leaking it, and the window title follows the page's by observation rather than by polling ([`7c3d788`](https://github.com/briancray/abide/commit/7c3d788a7eeed7ec0aef4566bb5caef7fdfb88d9))

### Patch Changes

- 4921bc9: nothing on the window's main thread waits on bun's own loop — a sheet's block is freed at the thread's next yield rather than on a timer it runs only when woken, and a test walks the window's modules from where the thread starts and names any timer, fetch, file, child or signal handler in them ([`1a03e70`](https://github.com/briancray/abide/commit/1a03e706b939b62588b9799874dd401361a75866))
- 4921bc9: the app runs on a thread of its own — RULEBOOK 38.180, cited from abide native and onStop, a line in ABIDE.md and a paragraph on the native page: shutdown work goes in onStop, since no signal reaches a process.on handler, and process.exit ends the whole app ([`87bd698`](https://github.com/briancray/abide/commit/87bd69862edbe1318852e4cd93bbf3c36f010977))
- 4921bc9: the app's own process.exit ends the native app — on the launcher's thread it ended only the worker, leaving the window open over nothing and Quit waiting on an answer that never came ([`dff2a07`](https://github.com/briancray/abide/commit/dff2a07aba18eb7a7ba8f149449e4569c931a300))

## 0.133.1

### Patch Changes

- 2631bc8: the cursor is the arrow again when a live resize of the window ends — the web view only sets one when the page's cursor changes, so the edge's resize arrows outlasted the drag ([`9312d59`](https://github.com/briancray/abide/commit/9312d596e4fd4a95bfb2823cc71bed95bd6847f2))

## 0.133.0

### Minor Changes

- 43a9bd0: the menu bar extra opens the window — Open <app> leads its menu, the window role brings the window forward, and a new window onto the app opens in the window ([`0117431`](https://github.com/briancray/abide/commit/01174314904ba9fc4635312eed9504cce65bb5a8))

## 0.132.0

### Minor Changes

- 68ae50f: `abide bundle` is now `abide native`, the name the rest of the native app already goes by — `src/native/`, `native()`, the docs' native page. there is no `bundle` alias: a script running `abide bundle` now runs `abide native`.

### Patch Changes

- 7f82a5a: a start keeps only what was changed, the launcher seals a sign-in with its own secret, and the native bridge runs onPairing's arguments ([`3f67aa1`](https://github.com/briancray/abide/commit/3f67aa16c3f230a5fa321f5880d9720842cc3648))
- Updated dependencies [7f82a5a]
  - @abide/bridge@0.7.3

## 0.131.2

### Patch Changes

- Updated dependencies [625e836]
  - @abide/bridge@0.7.2

## 0.131.1

### Patch Changes

- Updated dependencies [eb51ccb]
  - @abide/bridge@0.7.1

## 0.131.0

### Minor Changes

- f929fa5: a page per primitive, grouped; Claude Code at the top, rendering live examples in its answers; the docs as a native app ([`7c75644`](https://github.com/briancray/abide/commit/7c75644c947277540139dbcdf039d15732d0d6c0))
- f929fa5: a bundled app updates itself from a signed feed — 38.142-38.149 ([`807b9ad`](https://github.com/briancray/abide/commit/807b9ade085e62a595645b74ab284319a2c56b52))
- 8d12435: `native()` answers the version of the native app whose window a request came from, and `undefined` in a browser, on the CLI and outside a request. The window, and the menu bar extra's panel, append `abide-native/<version>` to the user agent of every request they make, so a server render and its hydration read the same answer (RULEBOOK 38.140, 38.141). It decides what a page shows and never who may do what: any client can send that user agent.
- 7e887bb: The bridge runs Claude Code in auto mode, and asks the page about anything auto mode would ask you: `provider.claudeCode` yields each prompt as a `permission` event, and `provider.claudeCode.permit(id, allow)` answers it. A granted tool is no longer approved just for being granted. `abide-bridge --full` (and `abide-bridge install --full`) gives a site everything your Claude Code has, and the native app's own bridge always runs that way.
- af74604: A site can ask a visitor's Claude Code for full access: `provider.claudeCode.bridgeCommand({ full: true })` and `provider.claudeCode.bridge({ full: true })` carry `--full` in the command and ask for it in the link, and `ABIDE_BRIDGE_FULL` does the same for `pairing()`. Opening such a link names no tool: it says the site is requesting full access, and offers Allow, Only Site Tools or Don't Allow. Allow is now kept for the site and the person its code was minted for, with no separate Always Allow, and an ask for full access is kept as it was answered; `abide-bridge forget` undoes it. The question is a macOS alert with a bold headline, and no longer names the bridge release, which the handler's log keeps.
- 8d12435: A native app built with `abide bundle` now pairs its window with Claude Code on the same machine. Nothing needs to be installed, no link needs clicking and no code is spent (RULEBOOK 44.77). `provider.claudeCode` runs turns there, inside the app's process, and pages see an ordinary paired `BridgeStatus`. The window's turns get every tool the site asks for, both built-in tools and MCP tools whose server is in the visitor's Claude Code user scope. `missing` lists only MCP tools whose server it doesn't find (RULEBOOK 44.78). Only the window counts as local. It proves this with a cookie minted at each launch, never by its user agent (RULEBOOK 44.79).
  
  The native app runs with the `PATH` the visitor's login shell sets, so it finds `claude` even when opened from the Finder (RULEBOOK 44.80). The window and the menu bar extra's panel now hand links of other schemes, such as `abide-bridge:` and `mailto:`, to macOS instead of failing them (RULEBOOK 38.174).
  
  `@abide/abide` now depends on `@abide/bridge`. The bridge's turn handling is now one module, `@abide/bridge/serveTurns`, shared by `abide-bridge` and the native app.
- 9d74469: The question a pairing link asks is each desktop's own, by the asking app: on macOS a native `NSAlert` the bridge shows itself, in front, with the site's `/icon.png` as its icon; on Windows a dialog with a bold headline, the icon and labelled buttons in place of Yes/No/Cancel; on Linux zenity or kdialog titled by the app, with its icon. The headline names the app beside its site — `CRM (crm.example)` — which `/__abide/bridge`'s holder answer now carries as `name`.
- 94592fa: The native launcher moves from `src/launcher.abide` to `src/native/launcher.abide`. The root's `native` directory is now a fence (RULEBOOK 23.33). A `native` directory deeper in the app is still an ordinary route directory. A root `launcher.abide` that still calls `onLauncher` fails the build and names where it goes (RULEBOOK 38.107).
  
  `onLauncher` takes new options for the native app's window:
  
  - `maxWidth` and `maxHeight` cap the window's size (RULEBOOK 38.150, 38.151).
  - `titlebar: 'hidden' | 'inset'` draws the page under the window's controls, which stay where macOS puts them. The page reads `--abide-titlebar-height` and `--abide-titlebar-inset` to keep clear of them, and is dragged by any element marked `data-abide-titlebar` (RULEBOOK 38.152, 38.153, 38.155).
  - `vibrancy` draws a macOS material behind the page (RULEBOOK 38.154).
  - `appearance`, `resizable`, `fullScreen`, `alwaysOnTop`, `shadow`, `rememberFrame`, `inspector` and `dock` each set one thing about the window (RULEBOOK 38.157-38.163, 38.165).
  
  The window now takes its background from the page's own background, and opens on the last one at the next launch, so it no longer flashes a default color (RULEBOOK 38.156).
  
  `menuBarExtra: true` puts the app in the macOS menu bar, drawn from `/icon-menubar.png` as a template image, else from `/icon.png` (RULEBOOK 38.166). A click opens `src/native/menubar.abide` in a panel under the icon, `panelWidth` by `panelHeight`. That page is answered at `/__abide/menubar`, outside every layout (RULEBOOK 38.167, 38.168, 38.171). Without that page, or with no app running, a click shows and hides the window (RULEBOOK 38.169). A right click lists the page's `onMenu` menus and Quit (RULEBOOK 38.170). Closing the window keeps the app running in the menu bar (RULEBOOK 38.172).
- 6531d98: An app can say why it asks to pair: `provider.claudeCode.bridgeCommand({ note })` and `provider.claudeCode.bridge({ note })`, or `ABIDE_BRIDGE_NOTE` for `pairing()`, keep a note with the pairing's code, and the question a pairing link asks shows it under its headline as the app's own words — `From CRM: …`, one line of at most 200 characters. The rest of the question stays the bridge's.

### Patch Changes

- f929fa5: the menu bar extra's panel hears of a staged update as the window does — 38.148 ([`7a4ef4d`](https://github.com/briancray/abide/commit/7a4ef4de33b9ddb26b8b4a42b82be7fc38c188fe))
- f929fa5: @abide/abide pins @abide/bridge at its exact version, and the pairing command reads it from the installed bridge ([`b8ac5ea`](https://github.com/briancray/abide/commit/b8ac5ea67278fc432149b19b34ede6f27273d493))
- 0747b5b: `MenuItem` admits a `MenuEntry`, as REGISTRY writes it, so an item `menuItem` makes can stand in a typed menu list.
- 9a804d6: A `Toolbox` a provider narrows before handing it to `provider.claudeCode` is the turn's toolbox: Claude Code is listed and answered its tools alone, rather than the request failing.
- Updated dependencies [f929fa5]
- Updated dependencies [f929fa5]
- Updated dependencies [f929fa5]
- Updated dependencies [f929fa5]
- Updated dependencies [f929fa5]
- Updated dependencies [f929fa5]
- Updated dependencies [7e887bb]
- Updated dependencies [fac557b]
- Updated dependencies [af74604]
- Updated dependencies [8d12435]
- Updated dependencies [9d74469]
- Updated dependencies [6531d98]
  - @abide/bridge@0.7.0

## 0.130.1

### Patch Changes

- 77e7d4b: A job that `App.stop` stopped now stays stopped until an app opens again. A job is a `global` `reactive` declaring `poll` with no owner. Before this fix, a bare `refresh()` or a `refresh` over tags made after the stop reloaded a job whose body is a stream, because a stream is reloaded whether or not anything reads it. The job then ran with no app open, and the next `App.stop` waited on that run. Such a refresh now only invalidates the job (RULEBOOK 7.40). A later `App.stop` no longer probes a job, because that probe would run the reload the invalidation owes (RULEBOOK 7.42). A read made while the app is stopped still runs the job, but it no longer starts the job's `poll` clock. The clock waits for `App.listen` or `abide dev` (RULEBOOK 7.41).

## 0.130.0

### Minor Changes

- 986bbcc: `database` closes the gaps that kept apps on a hand-rolled `bun:sqlite` opener. `strict`, `readonly` and `safeIntegers` go to `bun:sqlite` as given (RULEBOOK 47.14), and `open: (db) => …` runs at every open, after abide's pragmas and before the migrations, for a per-connection setting like `PRAGMA synchronous = NORMAL` (47.15). The opener carries `close()`, and the next call opens the file again; `close({ remove: true })` deletes it, so the next call opens it empty and migrated (47.16, 47.17). A file already at its count of migrations is not written as it opens, so a `readonly` opener works (47.18).
  
  Under `bun test` the scratch database is now a FILE, at the path the opener names inside a scratch directory of the test file's own, rather than an empty database in memory (47.4): two openers of one path share it, a second connection reads what the first wrote, and a database the app's stop closed opens again with what it held. The function naming the file is called under test too, so a config check inside it still throws (47.12), and it is called at each open and at no other call — a changed path takes effect at the next open, which `close()` asks for. `:memory:` stays in memory under test. A finished run's scratch directories are removed by the next run to make one (47.19). An app whose `.env.test` pointed its database at `:memory:` to stay off the real file can drop that line.
- 8ec6774: `pairing()`'s `status` is typed `Reactive<BridgeStatus | undefined, BridgeStatus | undefined, Failed<'HttpError', undefined>>`, so `status.error()` and `status.isError(error, 'HttpError')` are typed (RULEBOOK 44.69, amended). A `pairing()` built outside a component's setup — in a click handler — now has `stop()`, also its `[Symbol.dispose]` for `using`, which stops its read and follow, its timers and `copied`'s write back; one built in a setup is still stopped with it (44.73, amended).
- 9b3807a: `refreshes` takes a triple, `[rpc, pattern, { caller: true }]`, which refreshes `rpc` for the browser that made the write and no other — every tab of it — as `rpc.refresh(pattern, { caller: true })` does. `caller: true` is new on `rpc.refresh` and `rpc.invalidate` too: on the server it stands for the `principal.caller` of the request it runs in, and a request carrying none (a machine's call) reaches no browser. A value that depends on who is signed in rather than on its arguments — `whoAmI` — has no pattern to name the writer's copy by, and a tag would refetch it in every browser. RULEBOOK 16.104, 18.39.
- 09cd591: A sign-in or sign-out refreshes everything every tab of the browser reads, not only `principal`: a call whose handler ran `principal.set` or `principal.clear` has each tab refresh every value it holds save a `global` one, each serving what it holds until the new caller's answer lands, so a page no longer refreshes its per-user reads by hand after one. A `GET` that signs in reloads `principal` alone, since a `GET` is what the refresh calls. A value the server painted settled is now reached by a bare `refresh` too. RULEBOOK 26.24, 13.6.
- 761f7fe: `s.then(onSettled, onFailed?)` hands back a `Reactive` instead of a `Promise` (RULEBOOK 2.16-2.22). It is busy until the handler and anything it returned have settled, holds what the handler settled to, and its `error()` is the step that failed: the original refusal passed through with its `issues()`, or the handler's throw or rejection. A handler that returns a call is followed until that call lands, and the failures that call declares are typed onto the result (`Next`). `saving = save(args).then(next)` keeps the button disabled through `next`. `s.catch` and `s.finally` are built from `then` (1.5), so they hand back a `Reactive` too. `await` works as before. Code that typed the result as `Promise<…>`, returned it from a `bun test` body, or relied on `instanceof Promise` should `await` it instead. A step nothing reads is still reported as unhandled when its handler throws (2.20). Once a step is kept or read, the throw is on its `error()` and is not reported (2.21). The value is built the first time something reaches it, so `await s` pays for one function and builds no cell.
- 56b1ce6: After-success on a kept call is `saving.then(onDone)` — one argument. A `then` given no `onFailed` no longer reports the refusal it passes through as an unhandled rejection: the refusal already stands on `saving.error()` (RULEBOOK 2.15). An `await` still throws it, and a throw from `onDone` itself is still reported. The `() => {}` second argument every after-success site carried can go. The talk-to-the-server guide also covers a press-once form (`disabled={saving.busy() || saving.ready()}`), a union-typed kept value whose step needs one call's answer (keep that call under its own `const`), and a step that is not a call under the same busy flag and error (`saving = file.text().then((csv) => importDeals({ csv }))`).

### Patch Changes

- eca6610: A job's run that gives up because the app is stopping — it throws the abort `stopSignal()` raised — is no longer warned on as a failure. `App.stop` used to log "a polled run failed" (or "a revalidation failed") on every stop for any job honoring `stopSignal`. The value goes on serving what it held, and `s.error` carries the abort until the next run lands. An abort is now recognised whichever `DOMException` raised it, so a test's DOM preload no longer hides the runtime's own.
- c1b702e: A server render no longer overflows the stack building a module's value whose body reads the value itself. Values built up front under RULEBOOK 41.34 are rebuilt in every request, and a body whose first run there read its own value, such as `if (aborted) return copy.peek()`, reached a request instance that did not exist yet. It built another instance, which read again, until `RangeError: Maximum call stack size exceeded`, and the response was still 200. That first-run read now fails the run with a `ReferenceError`, the same error a browser raises when a `const` is read inside its own initializer (RULEBOOK 11.73). Only values that modules declare are now built up front. A value built in a component's setup, as when a test mounts a component in the same process as `createApp`, is not filed, and neither is one that nothing reaches any more (RULEBOOK 41.35).
- 89d1e1c: `abide format` accepts a script whose imports `bun fmt`'s `sortImports` merged or reordered: a code block's imports are compared as the modules and bindings they name, and the rest of the script as its tokens in order (RULEBOOK 38.127).
- f124040: A `GET` whose `tags` are a function of its args — `tags: ({ id }) => ['access', `thing:${id}`]` — is now reached by a server `refresh({ tags })` or `invalidate({ tags })` in every tab that follows it. The function cannot cross to the browser, so the server now answers it for the args each follow names, over the socket mux and over an event stream alike; before, only a list of tags was matched and every follow of such a `GET` was skipped. RULEBOOK 13.15, 18.4.
- e115489: A GET called with `{}` is answered from its seed when the browser's call carries no query: an `Args` of no members keys as an absent one (11.24). A stream the server painted closed hydrates closed with its chunks rather than busy (41.26, 41.33), and a call painted in flight stays in flight until the page has hydrated, however early the browser made it (41.27). A build that stops on a refusal prints it as `abide check` does, not as a stack (38.139).
- 7c23504: A function migration can call the app's own helpers that call the opener. While a migration runs, the opener hands back the `Database` that migration is migrating, inside its transaction (RULEBOOK 47.20), so a first boot can seed rows through an `insertCar`-style helper and a later migration that throws rolls those rows back too. Before, the call opened a second connection that waited out the 5000 ms busy timeout on the first one's write lock and failed the boot. An opener called from its own `open` hook or its file function, before there is a migrated `Database` to hand back, now throws an error naming RULEBOOK 47.21 rather than recursing until the stack overflows.
- f145429: A module's `reactive` whose body makes a call — `export const me = reactive(() => whoami())` — is now built for each request before the page and its layouts are set up, the way a browser builds it at import. Before, the server built it where the markup first read it, so the call started halfway through the build: regions built inline painted it in flight and a child built after the turn painted it landed, and hydration rebuilt whichever disagreed with the browser (15 `abide:hydrate` warnings on one real page). One page now carries one answer. Only values whose build outside a request left a load in flight are built up front; a value derived from one is still built where it is first read. RULEBOOK 41.34, 11.67.
- 052d479: ABIDE.md's testing notes say to mount a component inside the same `app.run` as the click whose call needs that scope: mounted outside and clicked inside, the call is written into the run's own copy of the value (11.32), and the mounted DOM never sees it busy or landed.
- 9d2dbe0: A `reactive` body that fails while it still serves only its opening `undefined` now fails outright: a read throws the failure and every value built on it hears it (RULEBOOK 2.2). The opening was held as if it were a value, so a value derived before the failure — `reactive(() => pairing().status())`, say — never reran and stood not ready with no `error()` for good, where the same value derived after the failure threw it.
- d58e7e7: A call the server painted settled is settled where the page hydrates, even when a module's value took it before it answered. `export const health = reactive(() => serverHealth())` and the like no longer have `{#if value.ready()}` rebuilt with an `abide:hydrate` warning ("server painted arm 0 … client chose arm 1") whenever the call answers after the page's modules load: hydration waits for it as it waits for any call painted settled, and it is no longer held until hydration ends. A call painted in flight is still in flight where the page adopts.
- 084b78a: `pairing()`'s `status` holds `undefined` until `/__abide/pairing` first answers, busy while that read is in flight, so a page's `{:else}Connecting…` arm paints and `await status` waits for the first status. A read that failed is taken as a refused write: it is on `status.error()`, and reading `status` goes on answering what it held rather than throwing, so `status?.paired` in an attribute, a listener or an `{#if}` needs no `ready()` guard and nothing reaches `onError` (RULEBOOK 44.69). A server render holds `undefined` with nothing in flight.
- 75c673f: The first `raw()` render in a page no longer counts the template markup is parsed in as a node it created: the page's template is made as the runtime loads, so a harness count over a raw render does not depend on whether anything parsed markup before it (RULEBOOK 32.93).
- 3f5fb1b: `store.sqlite` takes a `database` opener — `store.sqlite(crmDatabase, 'target')` — and calls it at each `get` and `set`, so a store sharing the app's file keeps working after `App.stop` closed that `Database` and the app boots again in the same process (RULEBOOK 8.41). A string handed to `store.sqlite` is now opened by `database`, so it gets the test-time scratch file and abide's pragmas, and a bare name is `<name>.sqlite` in `APP_DATA_DIR` (8.42). `database(fn)` throws where `fn` hands back anything but a string, rather than opening `undefined.sqlite` (47.3), and `close({ remove: true })` deletes the file the opener last opened even after the app's stop closed it (47.17).
- 777a074: `stopSignal()` is aborted for exactly the stop: from the moment `App.stop` begins until it resolves, `onStop` included, and a fresh, unaborted signal from then on. It used to stay aborted until the next `createApp`, so code linking it after an earlier app's stop in the same process — a test file — was handed a signal that already said stop.
- 6b08f1a: A server-rendered `style:prop` whose value holds a quote or an `&` is no longer corrupted. `style:background-image={'url("/a?x=1&y=2")'}` used to serve `background-image: url(&quot`, because the value was cut at the first `;` after escaping, and that `;` belonged to `&quot;`. The cut now happens before escaping. A `style:prop` whose value is `null`, `undefined` or empty is now left out of the served and built `style` attribute, separator included, matching what the browser's own write does. Before, it served `background-image: ;`. A `style` attribute beside `style:` directives no longer serves a doubled `; ;` separator.
- 344ba20: A handler whose answer may hold `undefined` as an array or tuple item is now a build error naming the handler and the path, e.g. `.points[]`. JSON writes such an item as `null`, so a page rendered on the server (which calls the handler in process and sees `undefined`) and the same page hydrated in the browser (which reads `null`) disagreed, and the handler's type promised the browser an `undefined` it never received. Write `null` there, or leave the item out. RULEBOOK 16.105.

## 0.129.0

### Minor Changes

- 226147b: `database` opens a file wherever the app keeps it: its first argument is a name (`<name>.sqlite` in `APP_DATA_DIR`, as before), a path — anything holding a `/` or a `.`, relative to the working directory, so `todos.sqlite` is that file, `':memory:'`, or a function returning one, called as the file opens so it can read `config()` — RULEBOOK 47.2, 47.3, 47.12. Under `bun test` the scratch database still wins, and the function is not called (47.4). `{ openNewer: true }` opens a file a newer build migrated, running nothing and leaving `user_version` alone; the default still refuses it (47.9, 47.13).
- 9088943: Breaking: the names only compiled `.abide` output calls are off the public entries. `@abide/abide` no longer exports `attributeMarkup`, `attributeText`, `boundProp`, `boundValue`, `groupHolds`, `selectedMarkup`, `escapeText`, `escapeAttribute`, `escapeStyleValue`, `listOf`, `heldProp`, `propCell`, `propCells`, `propOr`, `restValues`, `withoutKeys`, `markupRun`, `RAW_WRITES`, `currentShare`, `enterShare`, `leaveShare`, `resumeShare`, `safeUrl`, `slotValue`, `setupThrown`, `spreadAttributes`, `spreadProps`, `writePath` or `mutatePath`, and `@abide/abide/server` no longer exports `callsInRender`, `addressed`, `derivedArgs`, `renderComponent` or `fileRoute`. None had a REGISTRY row; an app that imported one (an `escapeAttribute` for its own markup, say) escapes with its own helper or `Bun.escapeHTML`. Compiled client modules import them from `@abide/abide/runtime`, and compiled server modules and handler faces from the new tooling entry `@abide/abide/server/runtime`. Every public entry's exports are now held to REGISTRY by a test.
- e705d3b: A kept call covers a real form. `reactive<typeof resetHome | typeof deleteHome>()` keeps a call of either handler — one value, its failures the union of theirs (RULEBOOK 4.19, amended). `s.then` takes one result type per arm, as `PromiseLike` does, so `saving.then(close, () => {})` type-checks whatever `close` answers: the step after a save is `saving = save(args); saving.then(onSaved, () => {})`, the refusal still on `saving.error()` (2.7, 2.8). A call is let go by keeping one nothing has made — `saving = reactive<typeof save>()` — where `saving = undefined` is a write to the call kept (11.59, 11.61, 11.16). A `Reactive` handed to `GET` as a value with a value's options is refused again now that it matches `PromiseLike` exactly.
- 995513c: **Breaking:** `bind:size`, `bind:visible` and `bind:rect` are gone, and so are `visibleIn` and
  `sizeBox`. An element is measured by an `observe` adaptor its `bind:element` takes:
  `bind:element={observe.size(box)}`, `observe.visible(seen, { in: scroller })`,
  `observe.size(box, { box: 'border' })` and `observe.rect(placed)`. Each takes a `Reactive` to write
  or a callback to call, and an `in` or a `box` given as a `Reactive` is watched. The old spellings
  are a build error naming the new one. RULEBOOK 32.79-32.92.
  
  `bind:element` takes a list of callbacks, each handed the element and each `Disposer` run when it
  leaves, so one element can carry more than one adaptor:
  `bind:element={[observe.rect(placed), observe.size(box)]}`. RULEBOOK 32.9.
  
  Inside a `.abide` file, a name passed as a member of an object literal holds the `Reactive` where
  the parameter's type declares that member one, as a `Reactive`-typed parameter already did.
  RULEBOOK 31.3.
  
  The observers, listeners and frame batching are the ones the binds ran on; a page that uses only
  `observe.size` loads neither of the other two.
- 1355114: `onPairing(() => args)` from `@abide/abide/server` files the Claude Code arguments every pairing's command and install carry after `--`, asked in the asking request's scope — so a site can hand each person their own `--mcp-config` or `--allowedTools` through the built-in `/__abide/pairing` rather than a bridge handler of its own. Each argument is quoted where a shell would split it, the link carries none, and a request still names none (RULEBOOK 44.74, 44.76, 37.7).
- c6f6243: a job can be spaced from its last run, put off at boot, and told to stop: `poll` takes `{ every, after: 'tick' | 'settle', delay }` beside a number, and `stopSignal()` is the signal `App.stop` aborts before it waits on a job's run — 7.20, 7.25, 7.32-7.39
- 7514530: A mutation's `refreshes` names selections as well as tags — `[boards, { personId }]` refreshes that one entry as `refresh(boards, { personId })` does — and its function may be `async`, run in the call's scope, so it can `await principal.resolved` to name whose entry the write changed. RULEBOOK 16.89, 16.101.
- 2ba96b2: BREAKING: the server's helpers are members of the names they belong to. The response helpers are
  `response.page`, `response.json`, `response.jsonl`, `response.sse`, `response.bytes` and
  `response.redirect` — `response()` still answers the status and headers being built (RULEBOOK 17,
  22.1); `response.redirect` takes a `URL` as well as a string, as `Response.redirect` does.
  `requestIP()` is `request.ip()` (22.12, 22.13). The two providers are `provider.claudeApi(config)`
  and `provider.claudeCode(config)`, with the pairing at `provider.claudeCode.bridge` and
  `provider.claudeCode.bridgeCommand` (44). The top-level `page`, `json`, `jsonl`, `sse`, `bytes`,
  `redirect`, `requestIP`, `claudeApi` and `claudeCode` exports are gone: change
  `import { json, sse } from '@abide/abide/server'` to `import { response } …` and call
  `response.json(…)`. A `global` value's body calling `response.json` or `request.ip` is refused at
  build as a read of `response` or `request` (11.37).
- 5191734: BREAKING: the shipped stores and abide's own refusals are namespace members. `webStore`,
  `indexedDBStore` and `cookiesStore` are `store.web`, `store.indexedDB` and `store.cookies` —
  `reactive('', { store: store.web('draft') })` — and `@abide/abide/server`'s `store` adds
  `store.sqlite` and `store.redis` (were `sqliteStore` and `redisStore`). `notFound`,
  `validationError` and `aborted` are `refuse.notFound`, `refuse.validation` and `refuse.aborted`,
  beside `refuse.named`. The old names are gone: rename each import to `store` or `refuse` and the
  call to its member (RULEBOOK 8.22-8.40, 15.7-15.9). A page reading `store.web` still loads that
  store alone, not its siblings (38.94). The `Store` type is unchanged.

### Patch Changes

- aee3e49: A framework ambient first built inside a request — `principal`'s members, built on first access — now builds its process-wide home outside that request. Built inside it, the home derived from that request's values for the life of the process, so a read outside every request (a bare `render`, a test) answered the first caller's principal.
- 4309881: Fix: `abide check` narrows a value a branch-local `<script>` declares the way it narrows the page's own — `{#if proposal}{#if other}{proposal.x}{/if}{/if}` no longer reports `proposal` possibly undefined, nor does an `{:else if}` arm or a `{#for}` row inside the guard; no `proposal!` or `?.` needed. A read outside the guard, after a write, or in a listener is still checked as the union (RULEBOOK 38.138).
- 3bc021d: Fix: `abide format` is idempotent — a multi-line `/* … */` comment in a branch-local `<script>`, a component's setup, a `<style>` or a multi-line expression no longer moves further right on every run. Each piece is handed to `bun fmt` with the indentation of where it stands taken off, since `bun fmt` keeps a block comment's continuation lines as given and abide indents them again (RULEBOOK 38.137).
- 6e4a193: Fix: `abide format <file>` formats the `.abide` it names instead of crashing with `ENOTDIR` — a path named is a file to format or a directory to format every `.abide` under, and the two mix in one run (RULEBOOK 38.125).
- ae8f6dc: `media(query)` first asked inside a request — a page's server render, in a test process that also mounts components — answers the browser's `matchMedia` outside it again, rather than the server's `false` for the rest of the process: the one value per query is built outside every request wherever it is first asked (RULEBOOK 23.30).
- 6649767: `pairing()`'s `status` fails with the failure where `/__abide/pairing` does not answer, so `status.error()` carries it and a page can say the assistant is unavailable rather than wait on a status that never lands (RULEBOOK 44.69).
- ce81023: An entry of a mutation's `refreshes` whose refresh fails no longer keeps the entries after it from refreshing; the first failure is still warned once on `abide:reactive` (16.102, 16.103).
- 721fa2f: A mutation whose `refreshes` fails — its function throwing or rejecting, or a refresh it asks for — answers as its handler returned rather than with a 500, and warns once on `abide:reactive` naming the handler. RULEBOOK 16.102.

## 0.128.0

### Minor Changes

- c4d4ee3: a streaming GET is read over the mux, holding no http connection while it streams — 16.93-16.96 ([`0a6594a`](https://github.com/briancray/abide/commit/0a6594ae3072bc88422cc65b04afdfee4416f39c))
- c4d4ee3: a follow is watched in its connection's scope, and reached by who it is — 18.36 ([`944049b`](https://github.com/briancray/abide/commit/944049b2768ead298cfa8582a1baa82b44487f30))
- c4d4ee3: pairing is read once and followed over the mux, holding no connection — 44.69 ([`c0020d0`](https://github.com/briancray/abide/commit/c0020d0c0eb40fdd18452eb5a82c2f3631bacac3))
- 5414067: `rpc.refresh(pattern, { caller })` and `rpc.invalidate(pattern, { caller })`: on the server, a trigger
  narrowed to the one browser whose `principal.caller` it names — sent to that browser's follows over the
  mux and no other's, while the server's own values are triggered as without it. In a browser, which
  cannot tell whose caller it is, passing one throws. A streaming `GET` is now read over the socket mux,
  holding no http connection while it streams. RULEBOOK 16.93-16.96, 18.37, 18.38.
- ca50c60: `pairing()` from `@abide/abide`: this browser's Claude Code pairing in a page — `status` (the latest
  `BridgeStatus`), `step` (`'click' | 'waiting' | 'install'`) and `copied`, with `start()` to pair with a
  click on the `abide-bridge:` link and `copyInstall()` to copy the install command. It reads the new
  built-in `/__abide/pairing`, which abide mounts off every generated surface and the page follows
  over the socket mux it already holds — no connection is held while it watches — so an app drops its
  own `bridge.server.ts` and the pairing code it copied.
  The tools a pairing grants are the server's to decide: set `ABIDE_BRIDGE_TOOLS` (comma-separated, an
  `onConfig` default or the environment); unset grants none, and a request naming tools is ignored.
  RULEBOOK 44.67-44.75.
- c9c621b: A name a destructuring pattern binds to a `Reactive` is read and written by name, as a declared one is:
  `const { status, step } = pairing()` reads `status` as its value and `step = 'x'` writes the `step` the
  pattern bound — object and array patterns, renames, defaults and nested patterns, `const` or `let`.
  RULEBOOK 31.17.
- cd1aa3e: Keep the call: a form holds the `Reactive` its write's call hands back instead of awaiting it in a `try` and copying the outcome out.
  
  - `reactive<typeof save>()` is typed as the value a call of `save` is — its value and its failures, `HttpError` and the `ValidationError` included (RULEBOOK 4.19) — so `saving = save(args)` type-checks and `saving.isError(saving.error(), 'Name')` narrows with no cast.
  - New probe `s.issues()`: the `data` of the standing `ValidationError`, typed `Issues<Args>` over a call, or `undefined` when none stands (RULEBOOK 3.15).
  - Fix: adopting a `Reactive` that has already failed, such as a call its `args` gate refused at the call, now wakes the readers of `s.error` (and `s.issues`). Before, `{saving.error()}` never heard that refusal.
- 3a3bd00: `bind:size={box}` writes an element's content-box `{ width, height }` and `bind:visible={seen}` whether it intersects the viewport — one way, from one `ResizeObserver` and one `IntersectionObserver` shared by every bound element, unobserved when the element leaves, and nothing written by the server (RULEBOOK 32.79-32.85). `bind:rect={placed}` writes the element's viewport rectangle as `getBoundingClientRect` reports it, re-read in one animation frame after a resize of the element, a scroll anywhere in the document, a window resize, or any other move of the element, which an `IntersectionObserver` fitted to its last rectangle reports — one scroll and one resize listener for every bound element, every read before any write, and nothing observed again while nothing moves (RULEBOOK 32.86-32.90). `media(query)` is a `Reactive<boolean>` following `matchMedia`, one value per query text, `false` on the server (RULEBOOK 23.30-23.32). While a page hydrates, `media` and `online` answer as the server did and are written the browser's answer once it has, so an `{#if}` they change is swapped as an update, with no 41.24 warning (RULEBOOK 41.32).
- 50d1773: With `ABIDE_OFFLINE` on, a page opens from the device again: a navigation the worker saved a page of
  is answered with that copy at once — its stylesheet and bundle from the device too — and the page is
  asked for behind it, so the visit after a deploy is the build before and the visit after that the new
  one; a reload asks the network first (chromium; webkit hands the worker a reload as a plain visit).
  A new build's worker keeps the build before's bundle files one build longer, so a page of it still
  open or opened as the new worker took over keeps its stylesheet and chunks rather than painting
  unstyled. RULEBOOK 45.8, 45.20, 45.28.
  
  The worker no longer refetches a navigation itself. Where it has no copy it answers with the
  browser's own navigation preload — the request the browser made, `sec-fetch-dest: document` and all —
  so a sign-in gateway that tells a page load by its fetch metadata redirects it to the identity
  provider instead of answering 401. Another origin's request and a frame's navigation are never the
  worker's; an answer is saved only where its `cache-control` names `stale-if-error` or `immutable`, so
  a page a gateway answers for itself is never opened from the device; and a page opened from its copy
  whose address now answers a redirect or a refusal is opened again, once, by the browser — a lapsed
  session reaches sign-in on that load. RULEBOOK 45.3, 45.25, 45.27, 45.29.
- e3a145f: `ABIDE_OFFLINE` is off unless the app's config or environment turns it on (`true`, or `1` / `true`
  in any case) — an app that wants its pages kept offline now says so, `ABIDE_OFFLINE=1`. A browser that
  installed the worker while it was on removes it on its next visit: the worker address answers the
  worker that unregisters and empties every cache it kept, once and with no reload. RULEBOOK 45.14, 45.9.
- 6690904: A polled value no component or request owns is now a background job the app can stop cleanly. `reactive(async function* () { … }, { global: true, poll })` already ran on its clock with nobody reading it and never overlapped itself (7.20, 7.21). Now:
  
  - `App.stop` stops the clock of every such poll before it drains (7.26), and once the requests have drained it waits for the run each one has in flight, before `onStop` and within `ABIDE_STOP_TIMEOUT` (7.27).
  - A failed run of a polled value warns on `abide:reactive` with the value's name, and the next tick runs it again (7.28). This covers each keyed entry and a first run that fails.
  - A job's first run is no longer made where the value is built. It happens when the app starts serving (`App.listen`, or `abide dev`), after every `onStart`, or when something first reads, probes or triggers it, whichever comes first (7.29, 7.30). An app booted in a test and never read runs no job, and its stop waits on nothing (7.31).
- 02fe5c8: `route.query(defaults)` — the address's query as one `Reactive`, shaped and typed by its defaults.
  Each member is read by its default's type (a number, `true`/`false`, text, or a list of text from a
  repeated name), and a missing or unparseable member reads its default. `query.tab = 'notes'` changes
  one member and `query = { tab: 'notes' }` replaces the lot, members left out going back to their
  defaults; either is one `navigate` with `replace` and `keepScroll`, members at their default left out
  of the address and members the defaults do not name left where they stand. A write on a server
  throws, as `navigate` refuses there. `url(path, params, query, defaults)` takes the same defaults as
  a fourth argument.
- a36a425: A mutation (`POST`, `PUT`, `PATCH`, `DELETE`) takes `refreshes`: the `tags` (or a function of the call's args returning them) that each run answering without a refusal refreshes on the server, reaching every tab following a value carrying one of them — `POST(write, { refreshes: ['stage:won'] })` in place of a `refresh({ tags })` after every call (16.89). It runs before the answer settles or is sent (16.90), at a streamed answer's close and not where the stream fails (16.91), and `GET` does not take it: a type error, and refused where a `GET` is declared with it (16.92).
- 5650413: `database(name, { migrations })` from `@abide/abide/server`: a lazy opener handing back bun's own `Database` for `<name>.sqlite` in `APP_DATA_DIR` — WAL, foreign keys and a busy timeout on open, each migration (SQL or a function) run once in one transaction tracked by `PRAGMA user_version`, a file a newer build migrated refused, an empty in-memory database per opener under `bun test`, and closed as the app stops (RULEBOOK 47).
- b3def9b: `ttl` on a value with no producer now writes it back to the value it was built with, `ttl` ms after a write, where it used to do nothing (6.2). `let copied = reactive(false, { ttl: 2_000 })` is a flag that resets itself with no `setTimeout`. A later write restarts the clock (6.11), a write of the opening value stops it (6.12), a refused write leaves it alone (6.13), and the timer never holds the process open (6.4) and stops with the setup or request that built the value (6.14). What is written back is a fresh copy of the opening value as it was built, so a `patch` never changes it (6.15), and an opening value `structuredClone` cannot copy whole — a function, a promise, a class instance — is refused at construction (6.16). A value with a body or a `store` keeps the expiry it had.

### Patch Changes

- c4d4ee3: a scrolled frame makes no position observer; the frame after the scroll does — 32.90 ([`00e9b52`](https://github.com/briancray/abide/commit/00e9b5268f3dae8535d7a688183355a654e3d02b))
- c4d4ee3: an answer the mux cannot carry is parked and taken over http — its handler runs once — 16.94 ([`210daf6`](https://github.com/briancray/abide/commit/210daf6107988c14c52eac8e8fce173bd45fdf5e))
- c4d4ee3: copied is a ttl value — 6.2 writes it back, 6.14 stops it; the copy timer goes — 44.72, 44.73 ([`4998c79`](https://github.com/briancray/abide/commit/4998c7988d81852f508eb2c5ebdf8ae3d2990cb6))
- c4d4ee3: under bun test each test file opens its own scratch database — 47.4 ([`51a4389`](https://github.com/briancray/abide/commit/51a438901d6bd81c3b533abc66e4530c93f01228))
- c4d4ee3: a parked answer is its own browser's, and its token never rides a URL — 16.98-16.100 ([`8794f3f`](https://github.com/briancray/abide/commit/8794f3f77fef209b254ce9f9619e78e9963fb740))
- c4d4ee3: a run's end never overtakes its last chunk to a forwarding reader — 9.17 ([`b260a8c`](https://github.com/briancray/abide/commit/b260a8c94439f570a60a21220baf5999c0da32c2))
- c4d4ee3: a failed revalidation warns on abide:reactive naming the value — 4.12 ([`bd56580`](https://github.com/briancray/abide/commit/bd5658031ef149a6e9d02bea2b0d23cd649bec80))
- c4d4ee3: an early-called stream goes over http to its first chunk, then the mux — 16.97 ([`c826708`](https://github.com/briancray/abide/commit/c82670835d697329c2ffa8892af45c83f158218f))
- 20df1d6: `abide check` holds a write through a member path to the member's type: `query.tab = 3`, `rec.n += 'x'`,
  `rec.list[i] = 'z'` and `rec.deep.s++` are refused on the line they are written, as a whole-value set
  already was. RULEBOOK 31.16.

## 0.127.0

### Minor Changes

- 43ece1a: Three new stores: `redisStore` (from `@abide/abide/server`, over `bun`'s `RedisClient`, expiring the
  key with the `ttl` and following its keyspace channel), `indexedDBStore` (the browser's IndexedDB,
  following other tabs' writes over a `BroadcastChannel`), and `cookiesStore` (a cookie through
  `cookies()`, so the server renders the stored value). Every shipped store now keeps its key under the
  app's name — a value `webStore` or `sqliteStore` kept under the bare key is not read back — and a
  re-read of unchanged text answers the value it answered before, so a `watch` echoing a store's own
  write wakes no reader.
- afad9a9: `TypeSession` (`@abide/abide/compiler`) no longer has `complete`, `references`, `belowRoot` or the `tsconfig` getter. Nothing called them: an editor asks `session.lowered(path)` and then `completionAt`, `LoweredFile.inspect` and `LoweredFile.references` directly, which is what `abide`'s language server already does.

### Patch Changes

- 068afc4: one fileIn, one signatureText, an inferred listenerOptions ([`01d05ba`](https://github.com/briancray/abide/commit/01d05ba5439ba1a7948abe5dcec3ba0c7831e261))
- 068afc4: an account holder is base64url text, not a decoded signature — 44.63 ([`03dc221`](https://github.com/briancray/abide/commit/03dc221b20abdeb5a93602c057a4936c170e1951))
- 068afc4: join a message's chunks once, not once per chunk ([`113aa9e`](https://github.com/briancray/abide/commit/113aa9eeafa60d7ce9d9a013b31f80279f1cd0f3))
- 068afc4: parse a route literal once, not once per call ([`1353d5e`](https://github.com/briancray/abide/commit/1353d5e1154d3fd1d77d221226483bae8629d07e))
- 068afc4: a row an async {#for} appends is enclosed by the {#for} — 12.18 ([`24cddc2`](https://github.com/briancray/abide/commit/24cddc233da3b52f574b4ca42b9ce83be68e77f9))
- 068afc4: a throttle window of Infinity stands open for good ([`3e3328f`](https://github.com/briancray/abide/commit/3e3328ffb993c66f151251bea29e87e573f2b559))
- 068afc4: one spelling each for the checker's and the layout's repeated reads ([`51fcabf`](https://github.com/briancray/abide/commit/51fcabf11ffc73ad6822c7416713425e02dceb3d))
- 068afc4: one ask of a store, one owned poll, and camelCase for mutable module state ([`657c444`](https://github.com/briancray/abide/commit/657c444207ade3af8b9ca73e0aa176678a7f993f))
- 068afc4: one spelling each for a refusal's name test, a record and option whitespace ([`6cadf8f`](https://github.com/briancray/abide/commit/6cadf8fc6fbfe446bd4a9eeb9fb505d7b026ff5f))
- 068afc4: a member no route parameter takes is kept as an own member — 16.66 ([`75ccc5b`](https://github.com/briancray/abide/commit/75ccc5b60d23e1f6afe139232adf312ba10e4d78))
- 068afc4: a run holding a no-break space is text, not layout — 33.17, 33.18 ([`77657f5`](https://github.com/briancray/abide/commit/77657f5ba0144914ca7b05881964f5d0accb4c10))
- 068afc4: a painted error page and a handler's page() are compressed documents — 38.29 ([`7a55366`](https://github.com/briancray/abide/commit/7a55366335c75ef39dbabfa2cac0530083e7676f))
- 068afc4: an unowned watch is enclosed by nothing — 12.18 ([`7d12d32`](https://github.com/briancray/abide/commit/7d12d3241d33c4f7fc1cbe6fcebde0d6df4bfa20))
- 068afc4: round-3 sweep — what round 2's lifts left behind ([`7ee1347`](https://github.com/briancray/abide/commit/7ee1347e2ef650e4dd593efabbcdef65605bb441))
- 068afc4: a framing is read off the type's essence, case-insensitively — 16.32 ([`81c755c`](https://github.com/briancray/abide/commit/81c755cf41b07fa8b2488f570b9f29abe8076199))
- 068afc4: one framework lookup, one newline run, one install dir ([`83e864a`](https://github.com/briancray/abide/commit/83e864a86088480792fe86efbeb94cd76a4a306c))
- 068afc4: fold the front-end's repeated spellings into one each ([`8774f8d`](https://github.com/briancray/abide/commit/8774f8d83c0ad5b2d22d227f698f4158f464a024))
- 068afc4: one spelling each for the listener, the loopback and the mux socket ([`92e2d56`](https://github.com/briancray/abide/commit/92e2d563938ca4ef3fe978050f9517c76111964d))
- 068afc4: one resume of a captured share scope, and comments that state mechanism only ([`9350141`](https://github.com/briancray/abide/commit/9350141164956aaecbdeb7a5499aaabc0ea22830))
- 068afc4: armTimer clears the standing timer; restoreFirst and stale notes go ([`9a7658f`](https://github.com/briancray/abide/commit/9a7658f684f9290dff3efbedf22888cf7fb77a0b))
- 068afc4: a navigation's 204 and an undisplayable page's 404 are private, no-store — 21.3 ([`e7dad57`](https://github.com/briancray/abide/commit/e7dad573ae9e35b9c9afec83079880ede860729a))
- 068afc4: checkSource lends the layout's parsed sources, not a re-read ([`eecf330`](https://github.com/briancray/abide/commit/eecf3309cf3d2182658ab89ae7ec200019bc406a))
- bf7c772: `abide scaffold` writes `tailwindcss` `^4.3.5`, and the harness's DOM preload registers happy-dom 21 — which fetches no stylesheet a parsed document names by default, so the preload no longer sets the deprecated `disableCSSFileLoading`.
- e32d563: A block updates before the blocks inside it (RULEBOOK 12.18): an inner `{#if}` woken through a derived value no longer runs after the `{#if}` around it has gone false — through a `{#for}`, a component, or a row an async `{#for}` appended — so the narrowing the outer block promises holds inside it.
- c4ab17e: A page and a public file served with `ABIDE_OFFLINE` on are asked of the network on every load
  (`max-age=0, stale-if-error=31536000`) rather than answered stale while it is asked behind — the visit
  after a deploy opens the new build, where it opened the last one's markup over a stylesheet the new
  one no longer serves and painted unstyled until a reload. The kept copy still stands in offline.
  Handler answers keep `stale-while-revalidate`. RULEBOOK 21.22, 21.23, 21.25.
- 7e33ff2: A `<script>` setup — a component's or a branch-local one — that reads a value still in flight now throws an error naming the setup's read and what to change, rather than a bare `NotLanded: reactive has not landed` (RULEBOOK 34.32). Inside an `{#if}` arm or a `{#for}` row the read is now reported as a failed effect (12.8) where it used to be dropped silently, leaving the arm unbuilt.
- b591e8b: A component `{...spread}` over a value still in flight no longer aborts the render or the mount around it: the server writes the invocation's region empty, and the browser makes the invocation once the value lands (RULEBOOK 32.23, 41.4). Before, `NotLanded` escaped `spreadProps` — no document on the server, and on a client navigation every tag after the spread never mounted.
- 444dedc: Because a signed-in pairing holder is now base64url text (44.63), a bridge's existing "always allow" for a signed-in visitor no longer matches, and they are asked once more. A load's `timeout` timer no longer holds the process open.

## 0.126.2

### Patch Changes

- 4920103: call and watch build their request through one requestFor, the shell its args through one argWords ([`0141da2`](https://github.com/briancray/abide/commit/0141da236993e13b73b8f3ba71a69ed49eae311c))
- 4920103: FRAMEWORK_SOURCES — the framework modules the checker names by file, in one leaf ([`1c0bf1c`](https://github.com/briancray/abide/commit/1c0bf1c3970abbec45e010d335a9b9310623bdf6))
- 4920103: one Backoff for the mux's redial and the outbox's resend — 18.33, 46.8 ([`2d04e02`](https://github.com/briancray/abide/commit/2d04e02da6ef249fb366ad1dbd79544422509ae0))
- 4920103: one leadingSpace, one pattern-name walk, readsBareProbe reads abideBindings ([`37b2b60`](https://github.com/briancray/abide/commit/37b2b6093d847279ce90674148d716984cb85936))
- 4920103: Mismatch writes 41.10's tail once ([`3a49b44`](https://github.com/briancray/abide/commit/3a49b440e2b9259b8c27240891b444e8fae535b4))
- 4920103: one placed() sink, components given at construction ([`3bb7659`](https://github.com/briancray/abide/commit/3bb76598c739335d16742404091bbffa254e997e))
- 4920103: Level.mount only enters the share — its head batch was reconcileLater's twice ([`40d77e8`](https://github.com/briancray/abide/commit/40d77e80db2286db5623adeb866aef41819043ff))
- 4920103: a new async source empties the list through clearList, one write rather than a removal a row ([`40dcb78`](https://github.com/briancray/abide/commit/40dcb78a058516ec0a0c93d57b282531bc076d37))
- 4920103: Router.follow arrives through arriveAt, one Found type ([`49f4de0`](https://github.com/briancray/abide/commit/49f4de0d1f435e4d95dc5e39f57b6cc4da7f6df2))
- 4920103: one NativeMenuItem in #shared for the menu a page tells the window and the window builds ([`4e46c08`](https://github.com/briancray/abide/commit/4e46c08ea3788aa2f64e122ba3582d8b2cab6026))
- 4920103: a head that throws is reported once, and a painted level stands as the server wrote it — 39.20 ([`542f651`](https://github.com/briancray/abide/commit/542f6511929659c98f667acb98758b7e45128c8c))
- 4920103: one HMAC for seal and unseal, own-origin compared directly, two names untangled ([`57b347f`](https://github.com/briancray/abide/commit/57b347f46c864a6ca59f2bc3a8dd281d2dc952a6))
- 4920103: an option's value decodes as the browser reads it — no RangeError out of a render — 32.61 ([`5d17032`](https://github.com/briancray/abide/commit/5d1703202c461196912d871f6a57e94a25c57a16))
- 4920103: HeadContribution's doc covers a level's own head; followHead's first run as it now is ([`75e96c4`](https://github.com/briancray/abide/commit/75e96c42ec36b4da18aa63e06769c9c10ea85a22))
- 4920103: one pngSize reads a PNG's signature and header for the manifest and the icon accent ([`784d229`](https://github.com/briancray/abide/commit/784d229234666b5db6a7cc97868fbd8805af4b56))
- 4920103: withoutProps reads the import off its tokens — no import glued onto the line above ([`7feb22c`](https://github.com/briancray/abide/commit/7feb22cb0c045b72b55c58bbbfb09e509db07efb))
- 4920103: the bare-busy probe is installed by the queue, so outbox.ts leaves sideEffects — 38.94, 46.11 ([`8a52546`](https://github.com/briancray/abide/commit/8a52546a8929ca4562bb4c48fdc9e9a76913a4ca))
- 4920103: emitClient renders the head once, one self-fill and one captured share ([`9500563`](https://github.com/briancray/abide/commit/95005630700fa7b81d257ac87e79546f237a27a3))
- 4920103: ABIDE.md says why markdown is untrusted — raw HTML and a javascript: link both run script ([`952cda3`](https://github.com/briancray/abide/commit/952cda39e00664e28668a8a4c74189c72f5c4763))
- 4920103: compiledPage sends the page on stdin — a 1000-card page is past Linux's per-argument cap ([`a632030`](https://github.com/briancray/abide/commit/a632030015e0741a81f68aab2706312c01e20fe0))
- 4920103: ownOrigin is 36.2's own origin, for the origin gate and the pairing link alike ([`b189c98`](https://github.com/briancray/abide/commit/b189c984a37da9fb98d2c48e71642324ded7f016))
- 4920103: one HeadChain for the chain a level reconciles through ([`b4be6c9`](https://github.com/briancray/abide/commit/b4be6c9a38302700313153a66aa42dad4626d401))
- 4920103: a head reconciles once a turn, not once a row — 39.13, 39.16 ([`b4c1935`](https://github.com/briancray/abide/commit/b4c193556268aaf3a15238a213e81456e5fe2e8f))
- 4920103: a render's recorded call takes the route its Rpc compiled — ROUTE_OF leaves ([`b5cc651`](https://github.com/briancray/abide/commit/b5cc65135b7accc7185698bcb501a242801b62ea))
- 4920103: one stream predicate, one derived layer, one realpath fallback ([`b93d149`](https://github.com/briancray/abide/commit/b93d1490d365f07cadcd6ba917cb43807c60901a))
- 4920103: a load timeout past what a timer holds no longer refuses at once — 16.59; one array-mutator list, one unref test ([`bbf1d2f`](https://github.com/briancray/abide/commit/bbf1d2f1cfc0b2deb25483eefd506a57239bd0d4))
- 4920103: round-2 leftovers — leadingSpace at its four inline copies, importsRaw via abideBindings ([`c5725cf`](https://github.com/briancray/abide/commit/c5725cfc2fab9213e40b7e776c3541e66f6363b6))
- 4920103: lineOf is the one line index, one lastAtOrBefore search ([`c7bcc6e`](https://github.com/briancray/abide/commit/c7bcc6e24c85c528f5a8fca26fe0504834647801))
- 4920103: one referencesIn — a symbol's references in a file, resolved ([`ca9b594`](https://github.com/briancray/abide/commit/ca9b5949162d62917492eb4982a654773a9f6206))
- 4920103: randomToken and the principal seal encode with Uint8Array's base64/hex, not Buffer ([`e209c02`](https://github.com/briancray/abide/commit/e209c0260e7599eda1c0b3413d54642521748693))
- 4920103: a head that throws costs one turn's reconcile, not every one after — 12.8, 39.16 ([`e69a244`](https://github.com/briancray/abide/commit/e69a24480fd10f72a27790d16f5a97aa9cc15fcd))
- 4920103: generatedSurfaces reads each segment's pattern from parseRoutePattern — 20.23 ([`f2dd7f8`](https://github.com/briancray/abide/commit/f2dd7f88c5f2f6ff27623c9647aab585c535aa89))
- 4920103: filledPath folds into filledSegments, log reads numberFromText, remote reads framingOf ([`f6e5806`](https://github.com/briancray/abide/commit/f6e5806c6e66359fe02ea6c82cc9cc7384d50e54))
- 4920103: rpcRequest writes the 46.10 idempotency-key itself ([`fefb779`](https://github.com/briancray/abide/commit/fefb779593eb2dc38fe0547d994904e137099c5e))
- e957231: A blank `ABIDE_MAX_LOG_BUFFER_COUNT=` falls back to the default buffer rather than reading as 0 and keeping no log records.
- ba23c6f: `abide call` and the shell print the RULEBOOK 30.3 message when JSON args (or no args) leave out a route parameter, as they already did for `name=value` args, instead of a bare "Unprocessable Content".
- a1d0354: Rows that each contribute to the document `<head>` reconcile it once a turn rather than once per row, so growing a list of 1,600 such rows no longer costs hundreds of milliseconds. And equal keyless head contributions from rows mounted together each keep a node of their own, rather than two rows adopting one (39.16).
- 3dad985: A `<head>` whose markup throws (a `<title>` reading a failed load) now stands as it last read and is reported once, rather than throwing out of every later head reconcile — a navigation, a component leaving — for as long as it stays mounted (39.20).
- 3cc3acb: A `{#for}` over an async source that is replaced empties the rows the last source appended in one write, rather than removing them one at a time.
- e957231: A handler `timeout` longer than a timer can hold (2³¹−1 ms, about 25 days) no longer ends the load at once with a 504: the timer is capped rather than overflowing to 1 ms (16.59).
- f2cd7b7: A server-rendered `<select>` reads a numeric reference in 0x80–0x9F through the windows-1252 remap, as the browser does: `&#128;` is `€`, so `bind:value` marks the option the browser's `option.value` says it holds.
- e957231: A client bundle that never queues a write no longer carries the outbox: its busy probe is installed by the queue rather than on import, so an app with no handlers drops it (38.94).
- 3cc3acb: The outbox restarts its retry wait from the floor when the page becomes visible, as the socket mux already did, so a queued write is retried promptly when a reader returns to the tab (46.8).
- b93aad7: A `.abide` file whose last `@abide/abide` import names `props` no longer compiles to an import joined onto the next import's line, which was a syntax error, and an import of `props` split over several lines is now read as one.
- e957231: The server render of a bound `<select>` reads its options' character references as a browser does: an out-of-range numeric reference such as `&#9999999;` becomes U+FFFD rather than throwing a `RangeError` out of the render, a reference without its `;` is read, and only ASCII whitespace is collapsed, so a no-break space in option text survives.
- 424f31b: `trace.span` stays open until a thenable its body returns settles, not only a native `Promise` — a `PromiseLike` from a client library no longer logs a 0 ms span or a 0 ms `server-timing` entry. A `Reactive` is still taken as a value and closes the span at once (24.8, 1.6).
- 2743db3: A `<style>` selector that is only a `::view-transition…` pseudo-element, such as `::view-transition-group(*)`, is left without the component's scope token, so it reaches the document's transition instead of matching nothing. 34.31

## 0.126.1

### Patch Changes

- 4c4c572: An array mutator whose arguments `await` compiles: `items.push(...(await load()))` in a `.abide` file evaluates its arguments before the copy is taken, rather than inside the mutator's own function, which is not async, so the build no longer fails with `"await" can only be used inside an "async" function` — and a write made while they are pending is kept (31.9).
- 4c4c572: `imagePiece` draws a JPEG at any size, so a photo's EXIF — a phone's GPS among it — is not sent with it and its orientation is applied (44.52). `imageFiles` hands back a pasted or dropped HEIC or HEIF, which `imagePiece` draws as a JPEG wherever the browser can decode one, and refuses where it cannot (44.55, 44.54).

## 0.126.0

### Minor Changes

- 5eb1a76: `claudeCode`'s `tools` asks for the visitor's own MCP tools as well as built-in ones — `mcp__calendar__meetings`, or `mcp__calendar` for all of a server's — granted the same way, through the command or the link (44.29). A `BridgeStatus` now always carries a command and a link, paired or not, and pairing with one replaces the bridge already paired, so a page can offer a reconnect (44.59). It also carries `missing`: the tools the pairing asked for that the visitor's bridge cannot give (44.60). `/__abide/bridge` names who a code was minted for, without spending it, for a bridge that always allows a site (44.63).

### Patch Changes

- d61b26b: An abort (a `DOMException` named `AbortError`: a superseded call's, a stopped stream's) reaches no `onError`, the browser's or the server's — 37.28, as 37.25 keeps an aborted call from `onRefusal`. The server still writes it to its log, and under `abide start` an abort nothing handled no longer stops the app (37.10).

## 0.125.2

### Patch Changes

- d1029ab: A `Middleware` whose `Extra` asks for `args` fits a keyed handler again — 16.86. 0.125.1's plain rung array inferred the handler's `Args` off the rung's `args: () => unknown` as well as off the `Keyed`, and refused the handler.

## 0.125.1

### Patch Changes

- one late-read writer for a handler's address, a named handler rung, resultsOf reads Rpc's own members — 16.88 ([`b74dc3a`](https://github.com/briancray/abide/commit/b74dc3a99385125ad76d5180e8ad9479cb4798b5))
- b9e4187: Rung helpers, `resultsOf` and a handler's address, from updating an app to 0.125 — 16.86, 16.88, 44.51
  
  - `resultsOf` takes any handler, whatever its args (it refused every handler with a parameter).
  - A rung list a helper builds (`middleware: rungs()`, `[...rungs()]`) carries its `Middleware`s' named refusals onto the `Rpc`, as an inline list does.
  - A generic rung helper takes its `Args` from the handler it is listed on again.
  - A handler file's `rpc.address` is its route as soon as the file loads, so a `bun test` importing it matches it with no app booted.
  
  MIGRATION from 0.124: a rung's `next` is typed `(ctx?: RpcContext<Args>) => Promise<…>`, so a rung written for any handler whose `next` takes a ctx with `args: () => unknown` no longer fits a handler with typed args — it could hand that handler args of the wrong shape. Type the helper over the handler's `Args` (`<Args>(…) => ((next: (ctx?: { request: Request; args: () => Args }) => Promise<unknown>, ctx: { request: Request; args: () => Args }) => unknown)[]`), or write the rung as a `Middleware`. A mismatch is now reported against `middleware` rather than as the handler not being assignable to `never`.

## 0.125.0

### Minor Changes

- e948e8e: `App.fetch` takes a `principal` and a `caller`, and `App.run` a `caller`, each answered as over the request's cookies with no cookie written — 42.20, 42.21
- 74eacfc: an assistant's `tool` and `result` events carry the handler they called (`{ method, address }`, as its `Rpc` reads them) and a result the value it answered, read off the app's own surface whichever provider ran the conversation — `resultsOf(events, handler)` is every successful call's value, typed as the handler's; a `Provider` now yields `ProviderEvent`s naming each tool as its `Toolbox` lists it; `AssistantMessage`, `AssistantContent` and `AssistantEvent` are exported from `@abide/abide` for the browser; `imagePiece(file)` and `imageFiles(dataTransfer)` turn a pasted, dropped or picked image into a turn's image piece, drawn down to 1568px — 44.48-44.55
- 1eaf716: `assistant` takes a `signal` in its options: aborting it ends the conversation at once, refused `aborted` at 499, even while the provider is stuck in an await — the same end a client leaving now gets — 44.57
- fd731a2: a `BridgeStatus` and `claudeCode.bridgeCommand()` carry `install`, the command that installs the bridge app the pairing link opens at the release the pairing command runs, so a page no longer parses the release out of `command` — 44.56
- c5ea214: `onError` from `@abide/abide`, called in a layout's or a page's `<script>`, hears in the browser what nothing caught — an uncaught throw, an unhandled rejection such as a call's refusal no handler caught, and an effect's throw — once each, nearest component first, for as long as the component stands — 37.16, 37.17, 37.18
- 17fdafe: `onRefusal` from `@abide/abide`, called in a layout's or a page's `<script>`, is handed in the browser every refusal a call over http is answered with — the handler's, a proxy's 401, the 503 for no answer, and one an `outbox` send gets — with the call's method and URL, once each, nearest component first, for as long as the component stands; the value still refuses — 37.22-37.27
- b436c3e: `abide dev`, `abide start`, the shell's app and a compiled executable's `start` take `--hostname` and listen on that interface alone — every interface where none is named, and the banner then lists no network address — 38.136; and `requestIP()` answers where the request being served came from, the same under `start`, `dev` and `App.listen`, or `'in-process'` for one no listener received — 22.12, 22.13
- c49316f: `isServer()` answers which side the running work is on — true inside a request, an `App.run` or a `render` even with a DOM preloaded, so an in-process test takes the server branch; an effect's throw no longer fails a server render beside that DOM, and `online` is true there — 22.11, 12.7, 23.8
- 02f34f7: a `middleware` rung is handed `ctx.lane` — the `Lane` that answers its request: a page, a handler, a public file, `openapi`, `mcp`, `bridge`, the socket upgrade, or the rest of `/__abide` — so a gate need not spell out abide's own addresses, and is handed the request below the mount — 37.19, 37.20
- 801345f: `poll` — a reactive option that refreshes the value every `poll` milliseconds, skipping a tick while it is busy and stopping with the value's owner or its `Keyed` (RULEBOOK 7.20 through 7.25)
- 3ffb8c0: `route.index` is the entry's place in the history the app's router wrote, and `navigate(by)` steps the history and settles once the step has arrived — 23.28, 23.29, 30.38, 30.39
- 380be01: `abide routes` names the rungs each handler's `middleware` declares, as written, and `--json` carries them as `middleware` on every route — `null` where the options are not written inline — 38.135
- 226e6a7: a refusal a rung names is on its `Rpc`'s failures and narrows by name, and `Middleware` takes the refusals it may answer with as a third parameter — 16.8, 16.86
- cbcd422: `webStore` (from `@abide/abide`) and `sqliteStore` (from `@abide/abide/server`) — shipped `Store`s for Web Storage, following other tabs' writes and inert on a server, and for a `bun:sqlite` table; both keep the value's `ttl` beside it and run an optional `schema` over what they read (RULEBOOK 8.22 through 8.28)

### Patch Changes

- 6f2742a: a handler whose parameter carries no annotation takes its `Args` from the `args` its options declare, now stated and gated — 16.87
- eb201fb: one spelling each for a server's stops, a refused call and a present member; endedBy races a fresh abort per step ([`47dffbf`](https://github.com/briancray/abide/commit/47dffbf3563895200aabed1fc4d7a65aa6764fe0))
- eb201fb: a render outside every request is torn down as a request is, and so is mount's server pass — 12.5, 38.119 ([`a7a2ada`](https://github.com/briancray/abide/commit/a7a2ada76a61df4f6632542b01083383d6218910))
- eb201fb: renumber clauses 22.11-12, 37.16-17, 38.134-135 to follow those merged beside them ([`d4ca7c5`](https://github.com/briancray/abide/commit/d4ca7c57ec2deb91eef08c6182729d561da5e8c6))
- eb201fb: a navigation the worker forwards is the page that hydrates — chromium sends it navigate with its destination empty — 41.29, 45.25 ([`f94c1bd`](https://github.com/briancray/abide/commit/f94c1bd4cfd9a416036bd8d918ce109f07642b66))
- 5d05e0e: `onError` from `@abide/abide` throws where it could never file — a `<script server>`, a server module, a module's top level, a later callback — naming `@abide/abide/server`'s, rather than doing nothing (RULEBOOK 37.21).
- 693c7f3: `abide check` holds an element's `bind:` to what the element writes back — a numeric input's `number | undefined`, a text field's string, a `<select>`'s strings, a boolean for `checked` and `open`, files for `files` — and a `type` written as an expression to the union of them — 32.78
- 20bb20a: a handler's value, and any `reactive` a module declares, built on a server where it is first reached, is no longer owned by the render or the component setup that reached it first — so it is not released when that one ends, and the next read neither runs its body again nor restarts its stream. A request's own instance is still that request's — 12.17
- d3b0202: `Issues<typeof handler>` is the issues of what the handler is called with, so a form's refusal state names the handler rather than `Parameters<typeof handler>[0]` — 19.26
- ce73c75: a prop handed to a component bound for `mount` as a getter is read through it on every read — 38.134
- e93eaf6: A mutator on a `Reactive` list typed with `undefined` or `null` — `drafts?.push(d)`, or `drafts.push(d)` once narrowed — is a write that wakes its readers, as on a list typed without them — 31.9
- 92f7c58: the offline worker asks the network for a navigation as that navigation, so a sign-in proxy redirects it rather than answering a fetch 401, and drops a saved copy the network answers over with a redirect or a 4xx — 45.25, 45.26
- 26ebcb7: a stream whose owner stopped and whose last reader left is started again by the next read, rather than staying stopped — a `{#for}` row or `{#if}` arm that comes back, or a streamed `GET` shared by a reader that left; and `mount` tears its server pass down as `render` does — 12.14, 12.16
- f215b78: a store miss that falls back to the initial value no longer writes it back through `set`, so a server render no longer overwrites a browser's store with the default — 8.8

## 0.124.1

### Patch Changes

- cd07376: a throttled or debounced body is busy while its window holds a run, and an await waits for it — 5.15 ([`1482fd3`](https://github.com/briancray/abide/commit/1482fd3368675794ab6db48ff1ff2c5b8861d68c))
- cd07376: a bind: through a path is checked as the get/set pair the build emits — 32.5 ([`c91d03f`](https://github.com/briancray/abide/commit/c91d03f816af91f994314fc17b2101d8ec77ec51))

## 0.124.0

### Minor Changes

- 057aef8: `TypeSession` (from `@abide/abide/compiler`) no longer carries `hold`, `projectWith` or `projectionOf`. Every analysis now asks the shadow program through one `ShadowHost`, which owns the snapshot a question runs against, so a caller no longer holds the session and reaches for a raw project by hand.
- 1a7baec: `abide scaffold` writes a Dockerfile and `.dockerignore`: the app built with `abide compile` on the bun that scaffolded it, and an image on distroless holding the executable alone (RULEBOOK 38.132).

### Patch Changes

- b50ba69: ABIDE.md points at a page address the bundled docs really carry (`guide/keep-it-current.md`), and names the scaffold's Dockerfile and `abide compile` (RULEBOOK 38.132)
- d3cee54: ABIDE.md says what a `watch` may write: its run assigns no state, and what a timer or a call it started hands back is written when that lands, as an event handler writes
- de50907: followers owned per app and passed to the mux ([`19e48d5`](https://github.com/briancray/abide/commit/19e48d5d12bdd12e648867e213442cdba0425cc1))
- de50907: a ShadowHost every analysis asks through, and one reads fixed point ([`1d3e371`](https://github.com/briancray/abide/commit/1d3e3710a5c42c09b44004b5142b47e09bcb20c6))
- de50907: split runDesktop into a DesktopSession and the window it drives ([`2174dc2`](https://github.com/briancray/abide/commit/2174dc22fea7c092b5ccf10807fd747fd632416c))
- 5221322: each test file under the test preload starts cold, so a file passes whatever order bun runs the files in — 38.133 ([`2afa677`](https://github.com/briancray/abide/commit/2afa67778caa5a15248d00cb6219078995b2d342))
- de50907: the selection index into selections.ts ([`4c58131`](https://github.com/briancray/abide/commit/4c581310ba08ccceaf213600b6f8166e186195c5))
- de50907: one issueReport module for note and issuesOf ([`4d2b85d`](https://github.com/briancray/abide/commit/4d2b85d88da14b474eaa7979347e5ca6ffc6e837))
- de50907: editor questions asked of the lowering a check registered ([`57d65a8`](https://github.com/briancray/abide/commit/57d65a8c009d4e4b3a740362e7e85ee97a9e3b10))
- de50907: one module owns the call starting a load ([`8331a7d`](https://github.com/briancray/abide/commit/8331a7df809e0f851a3ebb1d4b99f0b708d1d2be))
- de50907: a producer port for the verbs outside the core spend ([`84bfbbd`](https://github.com/briancray/abide/commit/84bfbbddcc96ed6dbaec78348d279c5873269698))
- de50907: one handler invocation for the http and socket lanes ([`8828727`](https://github.com/briancray/abide/commit/8828727a3c2fa24b8c5b37ef8b580aaaf874c0d2))
- de50907: declare the Cell shape once, in cellShape.ts ([`8fee2f4`](https://github.com/briancray/abide/commit/8fee2f49e63535e92e59240531669794b6f23b16))
- de50907: the reads fixed point returns its answers rather than filling the caller's ([`c704569`](https://github.com/briancray/abide/commit/c7045690405bb633c329a5252429485eca03d5c8))
- de50907: decide a navigation's outcome in a pure outcomeOf, executed by Router ([`dc055fc`](https://github.com/briancray/abide/commit/dc055fc290782ebd9b4ea50b0db23a4c408835a4))
- de50907: one page-render session owns seeding, recording and early calls ([`fcfb07a`](https://github.com/briancray/abide/commit/fcfb07aa398cedafdbd5cef87cecb022c712f6fa))
- d870b05: `abide format` opens an expression `bun fmt` breaks onto lines of its own at its brace — `{name` rather than `{    name` — the first line outdented like the rest (RULEBOOK 38.126).
- 5e3caa6: An array mutator called on a reactive name in a `.abide` file is a write: `tags.push(tag)`, `deal.notes.splice(0, 1)` and the rest run on a copy that the name then holds, so the page repaints (RULEBOOK 31.9). The receiver's type decides it — a class's own `push` or a `Map`'s `set` is still the value's call. ABIDE.md names `items.push(item)` as the write again.
- 2350996: A page's module, and every module it imports, is now evaluated outside the request that first renders it. In an executable `abide compile` writes, a module's `reactive` was built as the first request's own rather than per request, so whatever that request left — a signed-out caller's refusal — stood for every caller after it (RULEBOOK 11.67).
- d98f382: `abide scaffold`'s `bunfig.toml` comments fit the 80-column line the formatter prints.
- 37dddd1: A file with no extension imported `with { type: 'text' }` — a `Dockerfile`, a `LICENSE`, a `Makefile` — is its text under `abide dev` and `abide start`, where the page used to answer 500 (RULEBOOK 34.21).

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
