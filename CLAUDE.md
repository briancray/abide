# abide - isomorphic type-safe framework for async interfaces for humans and machines built on bun and web standards

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic with no ceremony
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all builds and environments
* isomorphism by default — same callable, same name, same *intent* on both sides
* uses typescript 7 for compiler
* valid typescript or javascript should always compile — in a `.abide`
* a cell is read and written BY NAME inside a `.abide` file, and the explicit `x()` / `x.set(v)` spelling must keep compiling — the sugar is over it, never instead of it. Naming a cell alone hands over the CELL; using it in an expression reads it. What counts as a cell is decided SYNTACTICALLY, so nothing in the emit path needs a type-checker and the javascript lane still compiles
* small and low level client bundle built from compiled .abide
* value performance when all other conditions are met

# seams and imports

* a bun workspace: `packages/abide` is the framework, `packages/example` is the dogfood. see "directory structure" below; import across the seams with the `$server` / `$ui` / `$shared` / `$compiler` tsconfig-path aliases, never with `../`. `./sibling.ts` inside one directory is fine — the rule is about CROSSING a seam, and a `../../` is the tell
* `packages/example` imports the framework by its PUBLIC specifiers — `abide` / `abide/ui` / `abide/server` / `abide/tests` / `abide/compiler` — through the workspace link and abide's own `exports` map, so a broken public entry point fails the example's typecheck instead of being papered over by an alias. an entry point nothing resolves through is an entry point nothing tests
* an export in the `exports` map is public SURFACE, not dead code — a static tool reporting it unused is reporting that the example does not exercise it, which is a gap in the dogfood, not machinery to delete
* before adding a helper, grep the sibling seam — the same utility on both sides of `$shared` is the duplication this layout invites. widen the existing one, or lift it to `$shared` when both sides need it; a second implementation is only right when the two seams have genuinely different invariants, and then the comment says which

# simplification

the standing bias: reduce machinery rather than layer on it. the rules below are how that gets checked — this line is the intent, not a test.

* do not worry about backwards compatibility if there is a better way to do something at any level unless it changes a public api - then discuss
* be aggressive in refactoring when it reduces machinery or increases performance
* when a mechanism is REPLACED, the replaced path leaves in the same change — a shim with no caller, a flag with one live value, an option nothing passes, a branch nothing reaches. machinery that outlived its reason is read on every pass and trusted by the next change, so deleting it later costs more than never landing it. if it must stay, the comment names what still calls it
* when changing behavior make sure it is represented in docs/spec.md and in `packages/example/demos` — a demo IS the test and the bench, so there is one place to change, not three. also check comments and remove stale information

# writing code

* use bun apis - not node apis unless necessary. a `node:` import in `packages/abide` names the bun api it stands in for, in the comment
* favor imperative/procedural over heavy functional abstractions: prefer `for` / `for of` to an iterator chain in any path walked per row, per frame or per node. three or more chained `.map` / `.filter` / `.reduce` over one collection is a loop written the long way, and each link allocates an intermediate — outside hot paths a short chain is fine when it reads better
* use descriptive variable and function names instead of abbrevations — a name is long enough when a reader who has not opened the callee can say what it returns. the exceptions are `i` / `j` as loop indices and the project's own established terms (cell, seam, arm, face)
* a named type earns its name with a second reference or an invariant worth stating; a type used at exactly one site belongs inline. narrow or widen an existing type rather than declaring a parallel one-use shape beside it
* write terse comments only when why is unclear. do not write comments where code is self explanatory — and when something was tried and reverted, record the MECHANISM, not just the outcome; an outcome-only note freezes the decision permanently. dont make comments a log of the past
* use tailwindcss classes for styling. a `style=` property is for a value computed at runtime — a measured width, a transform from state — and the comment names the value
* constants should be UPPERCASE_SNAKE_CASE always, including their files

# hot paths

a hot path is anything walked per row, per frame, per node or per chunk. the rules below are costs paid per iteration, so they are only rules there — elsewhere they are preferences.

* an object's shape is FIXED at construction: initialize every field the type declares, `undefined` included, rather than adding one on a later path, and keep an array to one element type. a shape that grows a field conditionally is two hidden classes, and every read downstream of it deoptimizes
* prefer a class or a plain record to a closure that captures its enclosing scope — a long-lived object built from a closure keeps that whole scope alive for the object's lifetime, so copy the fields it actually needs. no `delete`, no shape mutation, no dynamic property access in a path walked per row
* never `await` a value that is usually already settled — guard it (`isThenable(v) ? await v : v`); an unconditional await costs a promise wrap and a microtask tick at every call site, and a template slot pays it per row
* detect the common shape and skip the general algorithm — the expensive general path is the fallback, not the default
* a fast path earns its branch with a measured ratio; a branch that exists because ONE caller misbehaved is a patch — fix the caller, or deepen the mechanism until the case falls out of it. three special cases in one mechanism means the mechanism is wrong, not that a fourth is due
* when a shared path gains a DEFAULT with exceptions, enumerate the exceptions from the call sites rather than inferring them — "every caller but one" is one grep away from being checked, and a missed exception fails silently

# reactive invariants

these fail SILENTLY — the output stays right while the work goes wrong, so a correctness test cannot catch any of them. assert the work instead (see "performance and measurement").

* a freshly built wrapper defeats an identity check — when a value is re-wrapped per run (a state envelope, a result record), `oldValue !== value` is always true and every propagation cutoff downstream of it silently stops working
* the inverse costs too: when a value's IDENTITY is what wakes readers, rebuilding it is how the change gets signalled, and an accumulating value then pays a full copy per write — `concat` per chunk is O(n²) over a stream. separate the signal from the payload: push into a buffer, bump a VERSION for readers to subscribe to, and materialise the snapshot on the read that follows. which of the three variants is right is decided by the read/write ratio — version + lazy snapshot when writes dominate, structural compare that KEEPS the old identity when reads dominate (`router.ts`'s params), a cursor when the reader consumes in order (`wire.ts`'s line reader)
* a cap on what is REMEMBERED must not become a cost per write — if raising `tail`, a scrollback or a buffer size makes every write dearer, the retention is being rebuilt rather than appended to. assert it: a ratio between two sizes of the same structure, which is the one timing claim that stays honest across substrates

# performance and measurement

* write a bare bones vanilla js form of an implementation first to justify machinery by perf and LOC and complexity. if it causes tension with existing machinery deepen the vanilla rewrite to settle harmony
* machinery is budgeted in the same shape as perf, against the same vanilla arm: LOC over vanilla, exported names added, branches added to a shared path. an implementation that wins on ms and loses on all three is a trade to state out loud, never a default — and "it's faster" does not settle it, because the vanilla arm is what the ratio is against
* a performance claim is a RATIO against hand-written code in the same substrate — absolute ms from a DOM emulator describe the emulator, not the framework
* correctness tests cannot guard a performance contract: when the contract is "does less work", assert the work (nodes moved, allocations, calls) — the wrong implementation still produces the right output
* in a reactive system that means asserting WAKE-UPS, not values: count effect re-runs and body runs, because a reader that woke when nothing it reads changed still reads the right value
* budget emitted code in three numbers: allocations per template node, microtask ticks per row, DOM nodes per list item
* a benchmark case earns its place by DISTINGUISHING implementations, not by being representative — a full reverse cannot tell a minimal keyed reconcile from a rebuild; a two-row swap can

# demos and docs

* a case in `packages/example/demos` has three optional faces: `run` (headless, carries the assertions, runs under `bun test` AND in the browser card), `interact` (browser only — buttons and inputs), and `bench` (measurement arms, smoke-run headless). a claim that needs a click is a claim no test can make, so keep it out of `run`
* docs/spec.md is the succinct spec of public primitives and core terminology

# checks

a check produces CANDIDATES, not violations — it names the lines worth reading, and the rule above decides.

* `bun run typecheck && bun test` — the gate. green before a change and green after; run it from `~/Code` casing or typecheck fails on TS1149 for reasons that have nothing to do with the change
* `bun run lint` — unused locals, imports and parameters
* `bunx knip --workspace packages/abide` — exports and files nothing resolves through, for "when a mechanism is REPLACED". read it against the public-surface rule in "seams and imports" first
* `grep -rn "from ['\"]\.\./\.\./" --include="*.ts" --include="*.abide" packages/abide` — imports escaping a seam
* `grep -rn "from ['\"]node:" --include="*.ts" packages/abide` — node apis standing in for a bun api
* `grep -rn "style=" --include="*.abide" --include="*.ts" packages` — style properties that want to be tailwind
* `grep -rnE "\.(map|filter)\(.*\)\.(map|filter|reduce)\(" --include="*.ts" packages/abide` — iterator chains to check against the hot-path rule

# directory structure

* ./packages/abide - main abide package codebase
  * ./compiler - the `.abide` compiler (aliased to $compiler). `compile()` is pure; `plugin.ts` and `check.ts` are thin shells over it
    * ./internal - lex (TypeScript 7's scanner), desugar, parse, emit
  * /src - abide source
    * ./server - server source (aliased to $server)
      * ./internal - internal server source
    * ./shared - shared source between server and ui (aliased to $shared)
      * ./internal - shared source between server and ui
    * ./ui - ui source (aliased to $ui)
      * ./internal - ui internal source
  * ./tests - abide testing framework (reached as `abide/tests`)
    * ./internal - internal testing source
* ./packages/example - the dogfood: ONE abide app, served by `abide dev` / `abide build && abide start`, whose pages are the capability demos. there is no second server and no hand-written html per suite
  * ./demos - one suite per capability. each case is the demonstration, the test and the bench
    * ./vanilla.ts - the hand-written arms every bench ratio is measured against
    * ./dom.ts - hand-written furniture for the inside of a CASE. the page around it is abide; the case is a comparison, so its furniture must not be the thing under measurement
  * ./test - the thin runners that hand every suite to `bun test`
  * ./pages - what the app SERVES: the directory is the route table. `[suite]/[...rest]` is every capability suite, `bench` is their measurements, and the rest is the app's own
  * ./site - what those pages are made of: the card, the source pane, the nav, and the one scanner the panes and the slicing rpc share
  * ./server/rpc, ./server/sockets - what the app ANSWERS, including the endpoint that serves a case's own source
