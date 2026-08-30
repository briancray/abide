# What abide is

An isomorphic, type-safe framework for reactive async interfaces — for humans and for machines —
built on Bun and web standards.

**The problem.** Most of a web app is plumbing between two computers: a value lives on the
server, and you want it on screen. So you write a route, a handler, a fetch, a loading flag,
an error branch, a cache key, and a type you keep in sync by hand. Seven artifacts, none of
them the product, all of them yours to maintain.

**Everything is a reactive value.** Declare what a value *is*; reading it is what loads it.
There is one type, one spelling for a read, one place a failure surfaces, and a declaration
is keyed by its own arguments. That is the fetch, the loading flag, the error branch and the
cache key — four of the seven, gone.

**Same name, both sides.** The other three go with the API layer between them. `getInvoice({
id })` calls a function on the server and fetches an endpoint in the browser, under one name;
the build GENERATES the client from the same declaration, so the route, the handler and the
hand-synced type are not written twice and cannot drift.

**And for machines.** The declaration that serves a page already carries an address, a
method, argument and result schemas, and a description. Exposing an app to an agent is not a
second API to build and keep in step — it is the same handlers, described. This is the claim
no framework built for humans alone can make, and it is the one to lead with where the
audience knows what an MCP server costs to maintain.

# Who it is for

* An author building an app where things CHANGE — loading, reloading, streaming, failing.
* A team that already pays the cost of an API layer between its own two halves.
* Anyone who has to expose the same capability twice: once to a person, once to a model.

# Who it is not for

| | Why |
| --- | --- |
| A static marketing site | It renders one, but nothing here earns its keep if nothing on the page changes |
| Gradual adoption into an existing app | The `#ui` / `#server` / `#shared` seams are the mechanism, not a convention. There is no partial mode |
| A team that wants to swap the runtime | abide is Bun and web standards deliberately, and uses Bun's APIs rather than abstracting over them |

Saying these out loud is part of the positioning, not a disclaimer to bury. A framework that
claims to fit everything is read as fitting nothing.

# Load-bearing claims

Every claim below is one a reader can check. The right-hand column is what it rests on — if
that changes, the claim goes.

| Claim | Rests on |
| --- | --- |
| **No API layer.** | The build GENERATES the client module — one export per declaration, carrying method, mount-relative address and description, nothing else. It is not the server module shaken down. Importing a non-declaration from `#server/**` is a compile error, never a silent stub. |
| **One type back.** | `Reactive` is the only face. `state`, `memo`, `channel`, `rpc` and `socket` all hand one back, so `pending()`, `await`, `for await` and the probes mean the same thing on every one of them. |
| **Same name, both sides.** | `route.url`, `cookies()`, `log.info` and the rest resolve on either side. Nothing is a shim that no-ops on one of them; where a name genuinely cannot mean anything it throws and names the component and the accessor. |
| **Reading is what loads it.** | A `memo` runs its body on first read and re-runs when what the body read changes. There is no effect, no mount hook, no `load()`. |
| **It does not block.** | A read of a value still in flight returns `undefined` and opens a sink; the document goes out and the hole fills. Holding is opt-in and spelled `{await x}`. |
| **A refusal is a value.** | `Failed<Name, Data>` carries data and narrows by name with `isError`, in-process and over a wire, for a template and for a model alike. |
| **The schema is the type.** | A declaration's `schemas` are DERIVED from the TypeScript annotation and argument defaults — `GET(({ id }: { id: number }) => …)` builds the runtime schema for `{ id: number }`. The shape is never declared twice, and `abide check` type-checks `.abide` templates as well as the TypeScript, reporting each diagnostic on the `.abide` line. |
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

* **A section overview OWNS its opening.** The main overview shows the same words by pulling
  them with `{% lead <slug> %}`, so there is one place to edit them and the seam cannot drift.
  The build refuses a lead that carries a relative link, because it renders at two depths.
* **A nav label and a title are two registers.** The label is what a reader scans a sidebar
  for — one or two words, and words they ALREADY OWN rather than ours or another framework's.
  "Effects" was advertising the concept the pitch opens by refusing. The title is the problem
  they are solving, and it is a sentence: "On change" and "Do something when a value changes"
  are the same page.
* **An overview does not declare `covers:`.** It routes; the topic page covers. A capability
  counted as covered by a page that only links to it is a gate that has quietly stopped working.
* **If a section exists because pages were left over, split it.** Two one-line sections beat
  one section named after nothing they share.

# Vocabulary

The words are the product. A reader who learns one of these should not meet a synonym for it
three pages later.

| We say | Not | Because |
| --- | --- | --- |
| reactive value | container, store, atom, signal, observable | The type is `Reactive` and the prose word is "reactive value" — one word family at two registers, which is why nothing needs a separate noun for the thing as against its current value. Vue's `reactive()` is a transparent proxy rather than something you read with a call; the collision is accepted because every alternative is owned too and none of them is more precise |
| declaration | hook | `hook` is taken: `onStart`, `onStop`, `onConfig` are abide's lifecycle hooks |
| room | topic, subscription, channel instance | A room is what `channel` and `socket` both hand back, and it is a `Reactive` with `publish` |
| refusal, failure | error | An error is what went wrong; a refusal is a declared answer with a name and data |
| probe | flag, status boolean | `pending()`, `refreshing()`, `done()` — a probe never throws and never starts work |
| sink | placeholder, suspense boundary | An addressable slot a value in flight fills later |
| seam | layer, boundary | `#ui`, `#server`, `#shared` — an import edge the build enforces |
| both sides | isomorphic (in body copy) | *isomorphic* is the headline word and stays in the statement; every page after it says "both sides", which is what the docs already do. A third spelling is the drift this table exists to stop |
| by name | auto-tracking, magic reactivity | Reading `count` in a template IS `count()`; the sugar is over the explicit form, never instead of it |

**abide is lowercase**, in prose and in the wordmark, including at the start of a sentence.

# Voice

* **Show, do not argue. The example is the evidence.** Make the claim in as few words as it
  takes, then go straight into code that solves a real problem with as few concepts as it can.
  A reader who can check a claim in two seconds holds it; one who is asked to follow an
  argument is still deciding. This is the strongest form of "claim, then evidence" and the
  default — reach for prose evidence only where no example fits.
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
  demonstrate it, name the API in one clause and point at the page that does — "`invoice.reload()`
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
| Ground | A deep green-black in dark, a cool paper in light. Calm and technical — never black-with-a-neon-accent |
| Signal | Teal. Links, active nav, the `.abide` spine |
| Headings | Terracotta. Warm against a cold palette, and deliberately NOT the amber below |
| Amber | RESERVED for not-yet states — a stub marker, the server spine. Its presence always means one thing |
| Type | Space Grotesk for headings, IBM Plex Sans for body, IBM Plex Mono for code, captions and status |

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
