# abide - isomorphic type-safe framework for async interfaces for humans and machines built on bun and web standards

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic with no ceremony
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all builds and environments
* isomorphism by default — same callable, same name, same *intent* on both sides
* uses typescript 7 for compiler
* valid typescript or javascript should always compile — in a `.abide` `<script>` that holds for every STATEMENT and EXPRESSION position; the one exception is `export`, a deliberate compile error in both lanes because a `<script>` is not an ES module BOUNDARY. `<script module>` IS module scope, so `export` belongs there and the error names it
* a cell is read and written BY NAME inside a `.abide` file, and the explicit `x()` / `x.set(v)` spelling must keep compiling — the sugar is over it, never instead of it. Naming a cell alone hands over the CELL; using it in an expression reads it. What counts as a cell is decided SYNTACTICALLY, so nothing in the emit path needs a type-checker and the javascript lane still compiles
* small and low level client bundle built from compiled .abide
* value performance when all other conditions are met

# coding guidelines

* a bun workspace: `packages/abide` is the framework, `packages/example` is the dogfood. see "directory structure" below; import across the seams with the `$server` / `$ui` / `$shared` / `$compiler` tsconfig-path aliases, never with `../`
* `packages/example` imports the framework by its PUBLIC specifiers — `abide` / `abide/ui` / `abide/server` / `abide/tests` / `abide/compiler` — through the workspace link and abide's own `exports` map, so a broken public entry point fails the example's typecheck instead of being papered over by an alias. an entry point nothing resolves through is an entry point nothing tests
* use bun apis - not node apis unless necessary
* favor imperative/procedural over heavy functional abstractions
* use simple loops (for, for of) and straightforward control flow instead of deep iterator chains or high generic combinators in tight loops
* keep objects and arrays monomorphic so the JIT can optimize them agressively
* minimize dynamic features and complex closures in performance critical sections
* never `await` a value that is usually already settled — guard it (`isThenable(v) ? await v : v`); an unconditional await costs a promise wrap and a microtask tick at every call site, and a template slot pays it per row
* detect the common shape and skip the general algorithm — the expensive general path is the fallback, not the default
* when a shared path gains a DEFAULT with exceptions, enumerate the exceptions from the call sites rather than inferring them — "every caller but one" is one grep away from being checked, and a missed exception fails silently
* use descriptive variable and function names instead of abbrevations
* write terse comments only when why is unclear. do not write comments where code is self explanatory — and when something was tried and reverted, record the MECHANISM, not just the outcome; an outcome-only note freezes the decision permanently. dont make comments a log of the past
* use monomorphic types and narrowing/widening instead of ad-hoc or one use types
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* constants should be UPPERCASE_SNAKE_CASE always, including their files
* do not worry about backwards compatibility if there is a better way to do something at any level unless it changes a public api - then discuss
* be aggressive in refactoring when it reduces machinery or increases performance
* when changing behavior make sure it is represented in docs/spec.md and in `packages/example/demos` — a demo IS the test and the bench, so there is one place to change, not three. also check comments and remove stale information
* a case in `packages/example/demos` has three optional faces: `run` (headless, carries the assertions, runs under `bun test` AND in the browser card), `interact` (browser only — buttons and inputs), and `bench` (measurement arms, smoke-run headless). a claim that needs a click is a claim no test can make, so keep it out of `run`

# performance and measurement

* write a bare bones vanilla js form of an implementation first to justify machinery by perf and LOC and complexity. if it causes tension with existing machinery deepen the vanilla rewrite to settle harmony
* a performance claim is a RATIO against hand-written code in the same substrate — absolute ms from a DOM emulator describe the emulator, not the framework
* correctness tests cannot guard a performance contract: when the contract is "does less work", assert the work (nodes moved, allocations, calls) — the wrong implementation still produces the right output
* in a reactive system that means asserting WAKE-UPS, not values: count effect re-runs and body runs, because a reader that woke when nothing it reads changed still reads the right value
* a freshly built wrapper defeats an identity check — when a value is re-wrapped per run (a state envelope, a result record), `oldValue !== value` is always true and every propagation cutoff downstream of it silently stops working
* budget emitted code in three numbers: allocations per template node, microtask ticks per row, DOM nodes per list item
* a benchmark case earns its place by DISTINGUISHING implementations, not by being representative — a full reverse cannot tell a minimal keyed reconcile from a rebuild; a two-row swap can

# useful docs

* docs/spec.md - succinct spec of public primitives and core terminology

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
* ./packages/example - comprehensive demo with testing/benching built in
  * ./demos - one suite per capability. each case is the demonstration, the test and the bench
    * ./vanilla.ts - the hand-written arms every bench ratio is measured against
    * ./dom.ts - hand-written page furniture, so a bug in $ui cannot take its own demo off the air
  * ./test - the thin runners that hand every suite to `bun test`
  * ./web - the browser pages: one per suite, plus the bench, served by `bun run web`
