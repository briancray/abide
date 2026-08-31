# What abide is

An isomorphic, type-safe framework for reactive async interfaces — for humans and for machines —
built on Bun and web standards.

**The problem.** Most of a web app is plumbing between two computers: a value lives on the
server, and you want it on screen. So you write a route, a handler, a fetch, a loading flag,
an error branch, a cache key, and a type you keep in sync by hand. Seven artifacts, none of
them the product, all of them yours to maintain.

**Everything is a reactive value.** Declare what a value *is*; reading it is what loads it.
There is one type, it carries its own loading and its own failure, and a handler is keyed by
its own arguments. That is the fetch, the loading flag, the error branch and the cache key —
four of the seven, gone.

**Same name, both sides.** The other three go with the API layer between them. `getInvoice({
id })` calls a function on the server and fetches an endpoint in the browser, under one name;
the build GENERATES the client from the same handler, so the route, the wrapper and the
hand-synced type are not written twice and cannot drift.

**And for machines.** The handler that serves a page already carries an address, a method,
argument and result schemas, and a description — which is everything an OpenAPI operation, a
tool definition and a command need. So the build derives those three from the same route table
it derived the browser's client from: ONE HANDLER, FOUR SURFACES. Exposing an app to an agent
is not a second API to build and keep in step; there is no second artifact to keep in step at
all. This is the claim no framework built for humans alone can make, and it is the one to lead
with where the audience knows what an MCP server costs to maintain.

# Who it is for

* An author building an app where things CHANGE — loading, reloading, streaming, failing.
* A team that already pays the cost of an API layer between its own two halves.
* Anyone who has to expose one capability to more than one kind of caller — a person, a
  model, a generated client, a script in CI.

# Who it is not for

| | Why |
| --- | --- |
| A static marketing site | It renders one, but nothing here earns its keep if nothing on the page changes |
| Gradual adoption into an existing app | The `#ui` / `#server` / `#shared` seams are the mechanism, not a convention. There is no partial mode |
| A team that wants to swap the runtime | abide is Bun and web standards deliberately, and uses Bun's APIs rather than abstracting over them |

Saying these out loud is part of the positioning, not a disclaimer to bury. A framework that
claims to fit everything is read as fitting nothing.

# Load-bearing claims

Nothing below is checkable today, because the framework is not written — see Status. The right-hand
column is what each claim WILL rest on, and that is what makes it a design commitment rather than
copy: if the mechanism changes, the claim goes with it. `docs/SPEC.md` is the source and this
column cites it, so where the two disagree SPEC is right and the claim is stale.

| Claim | Will rest on |
| --- | --- |
| **Call a server function from a page.** No route, no fetch, no client. | The build GENERATES the client module — one export per handler, carrying method, mount-relative address and description, nothing else. It is not the server module shaken down, and importing a non-handler from `#server/**` is a compile error rather than a silent stub. A page has no back door either: a `.abide` file runs on both sides, so its render-time reads go through the same handler the browser would call. ONE CALL, NOT TWO PATHS — which is what lets the render's own answer be what the browser hydrates from. |
| **One handler, four surfaces.** A page, an OpenAPI operation, an MCP tool, a CLI command. | All four are DERIVED from the route table — a build artifact — rather than authored beside it, so no surface can describe a handler that does not exist or miss one that does. There is no document hook to rewrite the OpenAPI with and no second tool list: `abide mcp` forwards to the same endpoint rather than assembling its own. `clients` is the one record that withholds a surface, and every key defaults to true. It is NOT access control: `ui: false` is a compile error at the import, and the other three withhold a LISTING while the http address answers exactly as it did. Who MAY call is middleware, the same rung that decides it for a browser. |
| **One type back.** | `Reactive` is the only face. `state`, `memo`, `channel`, `rpc` and `socket` all RESOLVE to one — `state` and an unkeyed `memo` hand one straight back, the rest hand back a factory you call with its arguments first — so `pending()`, `await`, `for await` and the probes mean the same thing wherever you arrive. |
| **Same name, both sides.** | Same callable, same name, same question — `route.url`, `cookies()`, `log.info` and the rest resolve on either side, each answering it from what its side has. Nothing is a shim that no-ops on one of them; where a name genuinely cannot mean anything it throws and names the component and the accessor. |
| **Reading is what loads it.** | A `memo` runs its body on first read. An unkeyed one re-runs when what the body read changes; a keyed one is one entry per args key, and `ttl`, `invalidate` and `refresh` are its ways back. There is no effect, no mount hook, no `load()` — and no serialized setup either: the browser re-runs the same bodies, and what the render already fetched is what answers them, so the read that loads on the server is the read that hydrates in the browser. |
| **It does not block.** | A read of a value still in flight returns `undefined` and opens a sink; the document goes out and the hole fills. Holding is opt-in and spelled `{await x}`. |
| **A refusal is a value.** | `Failed<Name, Data>` carries data and narrows by name with `isError`, in-process and over a wire, for a template and for a model alike. It LANDS in the `Failures` of the `Reactive` that produced it — one place, whether a handler refused a request or a `transform` refused a write — so a refusal is read where the value is read rather than caught somewhere else. |
| **The schema is the type.** | A handler's `schemas` are DERIVED from the TypeScript annotation and argument defaults — `GET(({ id }: { id: number }) => …)` builds the runtime schema for `{ id: number }` — so the shape is never declared twice. A derived schema is exactly as good as the inference that reached it, and where inference cannot resolve an annotation the schema WIDENS rather than the file being refused, because valid TypeScript has to compile; declaring `schemas` is how an app pins one it will not have widened. `abide check` type-checks `.abide` templates as well as the TypeScript, reporting each diagnostic on the `.abide` line. |
| **Bun and web standards, not a wrapper over them.** | `cookies()` IS `Bun.CookieMap` on a server; an app that needs another bind address reaches `Bun.serve`'s own options rather than a variable abide would only pass through; the build is `Bun.build`. Handlers speak `Request` and `Response`, and rows arrive over a `ReadableStream`. |

# What we do not say

The measurement discipline in `CLAUDE.md` is a brand asset, not an internal rule. It is what
lets the claims above be short. Breaking it once makes every other claim a guess.

| Do not say | Until |
| --- | --- |
| Fast, faster, zero-cost, no overhead | There is a RATIO against hand-written code in the same substrate. Absolute milliseconds from a DOM emulator describe the emulator |
| A bundle-size number | The build exists and the number is measured, not estimated |
| Production-ready, battle-tested, stable | Something is in production |
| A comparison to a named framework | The comparison has been run on the same input, in the same engine, with the work counted — not just the wall clock |
| "Magic", "black box", "it figures it out" | Never. abide is transparent on purpose: every name is imported, no type is invented, and the compiled output is readable. Magic claims the opposite of the product |
| "It just works" | An example is adjacent. The code underneath is what makes it a demonstration rather than a promise; alone it is the one claim a reader cannot check |
| "Deletes", "kills", "no more X" | Never as the HEADLINE. Offer first and contrast second — "Call a server function from a page. No route, no fetch, no client." An absence is evidence for something already offered, never the offer itself |

**Today the honest frame is a DESIGN, not a product.** The workspace, the seams, the
measurement lanes and the documentation are real; the framework is not written. Say so. The
docs already do, and being early in public is only a liability if the copy pretends otherwise.

# Documentation structure

Three levels, and a reader may stop at any of them.

| | |
| --- | --- |
| Main overview | one section per area, each showing that area's own opening |
| Section overview | that same opening, then what does not fit on a landing page — every part linking to the page that covers it |
| Topic page | one problem, solved |

The mechanisms — `{% lead %}` and the `covers:` gate — are `docs/SPEC.md`'s, because the build
enforces them. What is below is what a reviewer enforces.

* **A nav label and a title are two registers.** The label is what a reader scans a sidebar
  for — one or two words, and words they ALREADY OWN rather than ours or another framework's.
  "Effects" was advertising the concept the pitch opens by refusing. The title is the problem
  they are solving, and it is a sentence: "On value change" and "Do something when a value
  changes" are the same page.
* **A label stands alone.** A nav label, a panel name and a heading are read with no sentence
  around them, so each carries its own subject. "By name" and "On change" are fragments waiting
  for a noun the reader does not have; "Values by name" and "On value change" are not. This is
  the heading rule extended to every label met out of context, and it is stricter — the pronoun
  check passes a fragment with no pronoun in it. Only the common shape is GATED — a
  preposition and a single word — and a fragment built another way is still a review question.
* **If a section exists because pages were left over, split it.** Two one-line sections beat
  one section named after nothing they share.

# Vocabulary

The words are the product. A reader who learns one of these should not meet a synonym for it
three pages later.

| We say | Not | Because |
| --- | --- | --- |
| reactive value | container, store, atom, signal, observable | The type is `Reactive` and the prose word is "reactive value" — one word family at two registers, which is why nothing needs a separate noun for the thing as against its current value. Vue's `reactive()` is a transparent proxy rather than something you read with a call; the collision is accepted because every alternative is owned too and none of them is more precise. The ban is on the reader-facing NOUN — `signal` stays available for the internal mechanism a probe or a selection holds |
| handler (noun), declare (verb) | declaration, hook | `hook` is taken — `onStart`, `onStop`, `onConfig` are abide's lifecycle hooks — and "a declaration" names the one shape these are not, a JavaScript function declaration being `function f() {}` where every handler is a `const` bound to an expression. You DECLARE a handler with `GET` |
| room | topic, subscription, channel instance | A room is what `channel` and `socket` both hand back, and it is a `Reactive` with `publish` — plus `revoke` and `clear`, which are the same write seen retroactively |
| refusal, failure | error (as the noun for a declared answer) | An error is what went wrong unexpectedly — `onError`'s subject, and what `s.error()` hands back. A refusal is a declared answer with a name and data, and `refuse` / `refuse.typed` are how one is spelled. The API keeps `error` where it means the first thing; prose keeps `refusal` where it means the second |
| middleware, rung | onion (as a noun for the mechanism) | `middleware` is the API and a rung is one layer of it. "Onion" describes the ORDER and is worth reaching for only where the order is the subject |
| reactive value | state (for anything but `state()`) | `state()` is one of the four; the by-name rule, the probes and `Reactive` reach all of them. Calling a memo or `route.url` "a state" is what made the by-name guide read as a `state()` rule |
| selection | group, set, query, batch | What `pending`, `refresh` and `invalidate` take — one memo, or every entry carrying a tag. A selection names entries; it does not run a query over them |
| probe | flag, status boolean | `pending()`, `refreshing()`, `done()` — a probe never throws and never starts work |
| sink, hole | placeholder, suspense boundary, slot | An addressable hole in the output a value in flight fills later. TWO REGISTERS OF ONE THING, the way `Reactive` and "reactive value" are: the SINK is the mechanism and the HOLE is what a reader sees, so "opens a sink; the hole fills" is one sentence about one thing. `slot` is `<slot/>` and nothing else — a value's position in text is a text position — and a `<slot/>` takes CHILDREN, never "holes" |
| adoption, adopt | wrapping, proxying, unwrapping, transparent forwarding | A memo body returning a `Reactive` ADOPTS it: the outer subscribes and MIRRORS its productions into its own ring, so the outer is always its own `Reactive` and every option applies to itself. Mirroring carries PRODUCTIONS and delegation carries MEMBERS, which is what keeps an adopted room a room — so "forwards" names the half it is not |
| production | value, message, chunk, item (as the general noun for what is retained) | What the producer YIELDED, one rule reading three ways: a `set` yields a value, a `publish` a message, a stream body a chunk. `tail` and `ttl` count productions, so reaching for any of the three as the general noun is what breaks the unit rule |
| seed buffer | sink, hydration data, embedded state | The seed buffer is how DATA reaches the client, by answering the client's own request; a sink is a hole in the MARKUP a late value fills. Two mechanisms, two lifetimes, and a document carries no copy of any answer |
| claims, principal, session | any one of the three for another | THREE THINGS. CLAIMS are the proof and the only thing in the cookie; the PRINCIPAL is what `onPrincipal` resolved that proof into, and is PUBLIC by definition; SESSION is app data addressed by what the claims identify, behind an ordinary rpc. Collapsing them to "session" is what puts something that grows into a cookie. `caller` is a fourth and none of them — a handle for WHICH BROWSER, carried whether or not anyone authenticated |
| surface | client, target, integration | `ui`, `openapi`, `mcp`, `cli` — one handler spoken in another vocabulary, and what `clients` withholds |
| seam | layer, boundary | `#ui`, `#server`, `#shared` — an import edge the build enforces |
| both sides | isomorphic (in body copy) | *isomorphic* is the headline word and stays in the statement; every page after it says "both sides", which is what the docs already do. A third spelling is the drift this table exists to stop |
| by name | auto-tracking, magic reactivity | Reading `count` in a template IS `count()`; the sugar is over the explicit form, never instead of it |

**abide is lowercase**, in prose and in the wordmark, including at the start of a sentence.

# Voice

* **Show, do not argue. The example is the evidence.** Make the claim in as few words as it
  takes, then go straight into code that solves a real problem with as few concepts as it can.
  A reader who can check a claim in two seconds holds it; one who is asked to follow an
  argument is still deciding. This is the strongest form of "claim, then evidence" and the
  default — reach for prose evidence only where no example fits. Every example is a real
  `.abide` or `.ts` file, benchmarked and covered end to end, which is what keeps it evidence
  rather than illustration.
* **Copy introduces the example and prices it.** A sentence before the block says which
  problem it solves; the caption after says what it cost — *1 file, 3 lines* against the seven.
  A reader should never have to work out why a block is on the page.
* **Second person, imperative.** What *you* write, what *it* does. "You write one instead", not
  "an author writes one instead".
* **Primitives, not plumbing.** The feeling to reinforce is weightlessness: the isomorphism and
  the concerns are compiled away, and what is left in the file is the thing the author meant.
  Every page should leave a reader with fewer moving parts than they arrived with.
* **Transparent, never magic.** Weightless is not opaque, and that distinction is the product.
  Every name is imported — `import { state, memo, route } from 'abide'` — no type is invented,
  and the compiled output is readable. Say what it removed, never that it handled it.
* **Name the noun, then the property that makes it worth having.** "Refusals that carry
  typed data" beats "saying no in a way the caller can use". A euphemism is longer than the
  noun AND vaguer: it costs the reader who knows the word and does not help the one who does
  not, because the noun gets defined in the body anyway. This is not the same rule as
  problem-shaped — a heading can be problem-shaped and still be a riddle.
* **A heading carries its own subject.** Someone arriving from the on-this-page list or a
  search result has no previous section. "Whether it has landed" is a pronoun with nothing to
  refer to; "Probes: `pending`, `refreshing`, `done`" is not.
* **A claim with no code beside it links out rather than being made.** Where the page does not
  demonstrate it, name the API in one clause and point at the page that does — "`invoice.refresh()`
  reloads. See Loading states." Prose evidence is for costs, which is what makes them credible.
* **Name the cost.** Every real trade gets said out loud — the seams are all-or-nothing, a
  `GET` that writes is reachable cross-origin, `config()` throws in a browser. Naming costs is
  what makes the claims believable.
* **Stack concepts, never stack prerequisites.** A page introduces one new concept and depends
  only on concepts already introduced. `covers:` in the frontmatter is where a page declares
  which ones, so the order is checkable rather than remembered.
* **No exclamation marks. No "simply", "just" or "easy" in front of an instruction** — "just
  add", "simply call" is the construction that makes a reader feel stupid when it does not
  work. "It just works" is a claim about the RESULT and is allowed with an example under it.
* **Problem-shaped, not capability-shaped.** Not what it can do — what an author uses it to
  solve. Every documentation page is titled this way, and marketing follows the docs.

# Visual identity

The full token set is `packages/dogfood/src/ui/app.css`; it is the source, not a copy.

| | |
| --- | --- |
| Ground | A deep green-black in dark, a cool paper in light. Calm and technical — never black-with-a-neon-accent — `--paper`, `--ink`, `--muted` |
| Signal | Teal. Links, active nav, the `.abide` spine — `--signal` |
| Headings | Terracotta. Warm against a cold palette, and deliberately NOT the amber below — `--heading` |
| Amber | The SERVER side — the spine, and the response arrow beside it — `--warm` |
| Blue | The BROWSER side, the same way — `--cool` |
| Type | Space Grotesk for headings, IBM Plex Sans for body, IBM Plex Mono for code, captions and status |

A stub marker takes `--muted`. It marks an ABSENCE, so it takes the ground's own recessive tone
rather than a reserved colour, and it goes when the framework is written — which is why it has no
row here to inherit.

**The signature is the code-block spine.** Every snippet carries a colored edge and a caption
naming which side it runs on — server, browser, or a `.abide` file that is both. It is the
framework's central idea made visible, and it is the one device to keep wherever the brand
appears.

# Status

| | |
| --- | --- |
| Real today | The workspace, the seams, the three measurement lanes, `docs/SPEC.md`, and the documentation site |
| Not written | The framework — the compiler, the runtime, the server |
| Therefore | Every claim above describes a DESIGN. None of them may be phrased as something a reader can run yet |
