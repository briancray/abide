# Brand

What abide says about itself, and how it says it.

## What this document is

A **brand**. Positioning, voice, vocabulary and visual identity, and it answers exactly one
question: *how do we talk about this?*

## What belongs here, and what does not

| A statement | Goes | Because |
| --- | --- | --- |
| How we describe the product, and to whom | here | positioning is a decision about an audience |
| Which word we use, and which we refuse | here | a vocabulary is a choice nothing else records |
| What a reader sees — colour, type, the code spine | here | an identity is a fact about the surface |
| What must hold | RULEBOOK.md | a requirement has a clause number |
| What a name is | REGISTRY.md | a signature is not a claim |
| Why the design refuses an alternative | DECISIONS.md | a maintainer's why is a different document |
| A measurement | the harness | a number in prose is a number nothing re-runs |

## Format rules

These are immutable. A change to them is a change to what this document is.

1. **A claim CITES its mechanism, and never restates it.** A claim carrying its own account of how
   the thing works is a third copy of the rulebook, and it drifts the way the second copy already
   did. Cite the clause number.
2. **No requirement keyword.** MUST, SHALL and MAY belong to RULEBOOK.md, and a check refuses them
   here.
3. **Every document this names exists.** A brand that cites a deleted file is making a claim about
   a source nobody can read, and a check refuses that too.
4. **A rule here is one only a READER can decide.** Anything checkable belongs in a test, and
   `packages/dogfood/tests/` is where it goes. What stays is voice, register and taste.

# What abide is

An isomorphic, type-safe framework for reactive async interfaces — for humans and for machines —
built on Bun and web standards.

**The problem.** Most of a web app is plumbing between two computers: a value lives on the
server, and you want it on screen. So you write a route, a handler, a fetch, a loading flag,
an error branch, a cache key, and a type you keep in sync by hand. Seven artifacts, none of
them the product, all of them yours to maintain.

**Everything is a reactive value.** Declare what a value *is*; reading it loads it.
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
column is the CLAUSE each claim rests on, which makes it a design commitment rather than copy: if
the rule changes, the claim goes with it. `docs/RULEBOOK.md` is the source and this column cites
it by number, so where the two disagree the rulebook is right and the claim is stale.

| Claim | Rests on |
| --- | --- |
| **Call a server function from a page.** No route, no fetch, no client. | 16.30, 16.31 — the client module is GENERATED rather than shaken out of the server's, and a non-handler import is a compile error. 16.12, 16.4 — a page's render-time read goes through the same handler a browser calls, so there is one call rather than two paths |
| **One handler, four surfaces.** A page, an OpenAPI operation, an MCP tool, a CLI command. | 20.1 — all four DERIVED from the route table, so none can describe a handler that does not exist. 38.9 — the CLI derives from the same table. 20.2, 20.3, 20.4 — `clients` withholds a surface and is not access control |
| **One type back.** | 1.1 — every producer hands back `Reactive`. 11.2, 16.4 — the keyed forms hand back a factory you call with its arguments first |
| **Same name, both sides.** | 16.29, 22.1, 23.7, 23.8 — a name resolves on either side, each answering from what its side has, and where one genuinely cannot it throws rather than no-opping |
| **Reading loads it.** | 11.4, 11.5 — a body runs on first read, and an unkeyed memo re-runs when what it read moves. 11.6 — `ttl`, `invalidate` and `refresh` are a keyed memo's ways back. 41.8, 41.14 — the browser's read is answered by what the render already fetched |
| **It does not block.** | 2.1, 2.2 — a read returns what it has. 3.4 — a pending value opens a sink and the hole fills. 11.21 — that reaches a derived value. 32.2 — holding is opt-in |
| **A refusal is a value.** | 15.1, 15.2, 15.7 — declared, structural, and landing in the `Failures` of the value that produced it. 4.9, 4.10, 4.11 — a refused write keeps the last accepted value on screen beside the message |
| **The schema is the type.** | 19.11, 19.12 — derived from the annotation and the argument defaults. 19.13 — where inference cannot reach, the schema WIDENS rather than the file being refused. 16.28 — a shape rides on the `Reactive`. 38.3 — `abide check` reports on the `.abide` line |
| **Bun and web standards, not a wrapper over them.** | 22.3 — `cookies` is one name on both sides, over Bun's own `CookieMap`. 36.1 — the port is read from the environment rather than from a config of ours. 17.1, 16.39 — handlers speak `Values`, `Request` and `Response` |

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
| "It just works" | An example is adjacent. The code underneath makes it a demonstration rather than a promise; alone it is the one claim a reader cannot check |
| "Deletes", "kills", "no more X" | Never as the HEADLINE. Offer first and contrast second — "Call a server function from a page. No route, no fetch, no client." An absence is evidence for something already offered, never the offer itself |

**Today the honest frame is a DESIGN, not a product.** The workspace, the seams, the
measurement lanes and the documentation are real; the framework is not written. Say so. The
docs already do, and being early in public is only a liability if the copy pretends otherwise.

# The four apps an example is drawn from

An example is a tiny product, and a product needs a world. Four are named here and nowhere else,
so a card is a pattern out of one of them rather than a situation invented at the moment of
writing. Why an invented world is refused is D42.

| The app | What it exercises |
| --- | --- |
| **A CRM** | Records loaded per id, forms over them, saves that can fail, fields not everyone may see |
| **An LLM chat** | Tokens arriving over time, a transcript that grows, a stop button, a room more than one caller reads |
| **An analytics dashboard** | Values derived from other values, queries cached per range, polling that must not stampede |
| **A media library and player** | One playback state many components read, settings that outlive the tab, artwork per id |

They are chosen to cover the surface between them rather than to flatter it: the CRM is the ordinary
case, the chat is the one nothing else on this list needs, the dashboard is where a wrong
recomputation is invisible, and the player is where state outlives the component that owns it. What
it costs when none of the four reaches an app abide fits is D42.

**A pattern is a problem the app has, not a name the framework has.** "The record you are editing
gets reloaded under you" is a pattern. "A write to a memo stands until the next recompute" is the
clause it lands on, and the clause is the page's title rather than the card's.

| The app | Patterns it has | Where they land |
| --- | --- | --- |
| CRM | Reopening a contact you already opened · a phone stored raw and shown formatted · your unsaved edit wiped by a reload · a save button that has to know in-flight from first-load | `memo` keyed, `transform`, a write to a memo, `pending` against `refreshing` |
| CRM | A list that must not refetch because you sorted it · a search that holds what each query found | `memo` unkeyed, `memo` keyed |
| LLM chat | A transcript that grows without being rebuilt · a stop that leaves the partial answer standing · one answer many tabs read | `tail`, `refresh`, `channel` |
| Dashboard | A total that follows its filter · a metric three tiles want and one load answers · a poll that has to be capped · a count that quietly stopped following its filter | `memo` unkeyed, `global`, `throttle`, tracking after `await` |
| Player | A now-playing bar and a library that agree · a volume that survives the tab · a scrub that fires per frame | `state.share`, `store`, `debounce` |

**Why 40.29 holds a page to one app.** Six cards drawn from four worlds is six worlds to enter, and
the reader pays that toll per card while the thing being taught is the same one throughout.

**Why 40.30 seats a control with its value.** Held apart from it a button has to name its own
subject — "add one" of what — and that name is longer and vaguer than the arrow it replaced. This
is the same economy the readouts are under: what the layout can say, the words do not have to.

# What an example has to prove

40.31, 40.32 and 40.33 are one rule rather than three, because dropping any one is a distinct way
for a card to go wrong: a card that proves nothing is
decoration, a card that proves it in forty lines has buried the proof under the setup, and a card
that proves it in a world nobody has is proving it to nobody.

**A CARD THAT DOES NOT LAND IS A DIAGNOSIS, not a writing problem**, and reaching for a rewrite is
how one gets polished through several drafts while staying wrong. What the two diagnoses are, and
the worked case they were read off, is D44.

**Both halves answer to the situation.** A capability is worth proving where the app would reach
for it, so "the reshaped record can still be refreshed" earns a card and "the reshape runs once per
production" does not — the second is true, and no CRM has ever wanted it stated. The test is what the app would
put on the screen: a number nobody in the situation would look at is a capability nobody in the
situation needs, and a count kept only to prove a point is code the proof did not need (D45).

# Documentation structure

Three levels, and a reader may stop at any of them.

| | |
| --- | --- |
| Main overview | one section per area, each showing that area's own opening |
| Section overview | that same opening, then what does not fit on a landing page — every part linking to the page that covers it |
| Topic page | one problem, solved |

The three levels are 40.16's, the constraint on a lead is 40.37's and the map section is 40.38's;
the `{% lead %}` directive is the build's. SOME OF WHAT IS BELOW IS GATED as well, in
`packages/dogfood/tests/coverage.test.ts` and `voice.test.ts` — the tests are the list, an
enumeration here being a second copy of them that nothing re-runs. A rule here that turns out to be
checkable belongs in a test rather than in prose; what stays is what only a reader can decide.

* **A page's LEAD is what the section overview says about it.** 40.37 is the constraint and also
  the test: the lead is about the whole page rather than about whatever the first heading happens
  to be, and an opening that describes the first card advertises the page as that one card.
* **Where a page's subject is a NAME, the first section is the map 40.38 asks for.** A reader
  arriving to compare two spellings gets them in the first screen instead of assembling them from
  six sections; one who came to learn scrolls past a table costing four lines. It fits a page whose
  subject is one name with variants, which is most of the primitives, and it does not fit a page
  about a technique — a schema page has no two forms to lay out, and a map of one thing is
  furniture.

* **A nav label and a title are two registers.** The label is what a reader scans a sidebar
  for — one or two words, and words they ALREADY OWN rather than ours or another framework's.
  "Effects" was advertising the concept the pitch opens by refusing. "Watching values" is not
  that trade: `watch` is a callable an app imports and types, so the label names a primitive
  rather than a mental model — naming what we ship is only a cost where the pitch declines the
  thing. The title is the problem they are solving, and it is a sentence: "Watching values" and
  "Do something when a value changes" are the same page.
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
| room | topic, subscription, channel instance | A room is what `channel` and `socket` both hand back; the shape it has, and why it has no `revoke` and no `clear`, is 9.19 and D8 |
| refusal, failure | error (as the noun for a declared answer) | An error is what went wrong unexpectedly — `onError`'s subject, and what `s.error()` hands back. A refusal is a declared answer with a name and data, and `refuse` / `refuse.typed` are how one is spelled. The API keeps `error` where it means the first thing; prose keeps `refusal` where it means the second |
| middleware, rung | onion (as a noun for the mechanism) | `middleware` is the API and a rung is one layer of it. "Onion" describes the ORDER and is worth reaching for only where the order is the subject |
| reactive value | state (for anything but `state()`) | `state()` is one of the four; the by-name rule, the probes and `Reactive` reach all of them. Calling a memo or `route.url` "a state" made the by-name guide read as a `state()` rule |
| selection | group, set, query, batch | What `pending`, `refresh` and `invalidate` take — one memo, or every entry carrying a tag. A selection names entries; it does not run a query over them |
| probe | flag, status boolean | `pending()`, `refreshing()`, `done()`, `success()`, `streaming()`, `error()` — what a probe will not do is 3.1 and 3.2 |
| sink, hole | placeholder, suspense boundary, slot | What 35.7 defines. TWO REGISTERS OF ONE THING, the way `Reactive` and "reactive value" are: the SINK is the mechanism and the HOLE is what a reader sees, so "opens a sink; the hole fills" is one sentence about one thing. `slot` is `<slot/>` and nothing else — a value's position in text is a text position — and a `<slot/>` takes CHILDREN, never "holes" |
| adoption, adopt | wrapping, proxying, unwrapping, transparent forwarding | A memo body returning a `Reactive` ADOPTS it, per 11.13 and 11.15, so the outer is always its own `Reactive` and every option applies to itself. What mirroring carries and what delegation carries are different halves, so "forwards" names the one it is not |
| production | value, message, chunk, item (as the general noun for what is retained) | What the rulebook's Terms table defines. `Produced` is the separate word for what a producer YIELDED, which on a stream is a chunk and is not a production. `tail` and `ttl` count productions, so reaching for any of the four as the general noun breaks the unit rule |
| seed buffer | sink, hydration data, embedded state | The seed buffer is how DATA reaches the client, by answering the client's own request; a sink is a hole in the MARKUP a late value fills. Two mechanisms, two lifetimes, and a document carries no copy of any answer |
| claims, principal, session | any one of the three for another | THREE THINGS. CLAIMS are the proof and the only thing in the cookie; the PRINCIPAL is what `onPrincipal` resolved that proof into, and is PUBLIC by definition; SESSION is app data addressed by what the claims identify, behind an ordinary rpc. Collapsing them to "session" puts something that grows into a cookie. `caller` is a fourth and none of them — a handle for WHICH BROWSER, carried whether or not anyone authenticated |
| surface | client, target, integration | `ui`, `openapi`, `mcp`, `cli` — one handler spoken in another vocabulary, and what `clients` withholds |
| seam | layer, boundary | `#ui`, `#server`, `#shared` — an import edge the build enforces |
| both sides | isomorphic (in body copy) | *isomorphic* is the headline word and stays in the statement; every page after it says "both sides". A third spelling is the drift this table exists to stop |
| by name | auto-tracking, magic reactivity | Reading `count` in a template IS `count()`; the sugar is over the explicit form, never instead of it |
| tracked / subscriber | either for the other | TWO REGISTERS OF ONE MECHANISM, the way sink and hole are. TRACKED is a property of the POSITION — whether a read there is captured at all, which is what REGISTRY's Tracking table answers. A SUBSCRIBER is the edge a tracked read registers. They come apart at exactly one place and it is load-bearing: on a server a render read IS tracked and registers NO subscriber, there being no rerender to feed — which is why a watch runs once there, and why an eager trigger is bounded by subscribers rather than by what is tracked |
| subscriber | on screen, displayed, visible | What decides whether an EAGER trigger loads: anything reading the value into the output — the template showing it, or a `memo` that is itself subscribed. "On screen" is the common case and therefore reads as the rule, so it is wrong for exactly the case that matters, a derived value nothing renders directly. The distinction is what 7.14 and 13.7 are written over, and it cannot be said in the loose vocabulary |
| name (verb), for identifying WHICH ONE | name as the general-purpose transitive | A heading names its subject, an anchor names a line, a selection names entries — the verb carries identification, and reaching for it as a catch-all empties it. "Neither button names anything" was trying to say neither button REPEATS a cache key; "naming reaches anything" was trying to say an EXPLICIT ARGUMENT does. Where the sentence means repeats, passes, declares, holds or points at, that is the word, and the sentence gets shorter |

**abide is lowercase**, in prose and in the wordmark, including at the start of a sentence.

# Voice

* **Show, do not argue. The example is the evidence.** Make the claim in as few words as it
  takes, then go straight into code that solves a real problem with as few concepts as it can.
  A reader who can check a claim in two seconds holds it; one who is asked to follow an
  argument is still deciding. This is the strongest form of "claim, then evidence" and the
  default — reach for prose evidence only where no example fits. Every example is a real `.abide` or
  `.ts` file, and 40.3 asks it for a bench and a spec, which is what keeps it evidence rather than
  illustration. TODAY THOSE ARE AUTHORED, not run — neither can execute until the compiler
  does — and every panel carrying one says so, because a number that reads as measured is worse
  than no number.
* **Four layers reach a card, and each says a thing the others cannot.** The HEADING is the
  claim, in the reader's words, and 40.31 is what binds the card to it. The card's TITLE is the
  signature and a gloss, which is the address in the API the claim is about. The card's SUMMARY
  is the situation and what to do in it, one or two sentences. And the copy AFTER the card is
  everything none of those can carry: the reason, the refusal, the thing the running page cannot
  show. 40.34 is what keeps a fourth voice out from between a heading and its card — the layer that kept being
  written and is always a fourth voice restating one of the other three — a card had a heading
  saying a memo re-runs when what it read changes, then a paragraph saying reading is what
  subscribes, then a title saying auto-tracked derivation, then a summary saying the total
  follows the seats. Four ways to say it before anything had been shown.
* **The opening card is the one to price.** The line after it says what it cost, against the
  hand-written arm the example carries. A page's opening card
  carries the claim the title made; the cards after it are already inside an argument the reader
  has accepted, and pricing each of them turns the device into furniture.
* **Second person, imperative.** What *you* write, what *it* does. "You write one instead", not
  "an author writes one instead".
* **Say it plainly. The instruction is the shortest a claim comes in.** "Set `tail` to keep
  more" against "Retention past that is a memory ceiling you name, and it is the same option
  wherever the value came from" — same fact, and the first is checkable in the time it takes to
  read. THE TEST IS NOT THE GERUND: "Reading loads a value" is a CLAIM about the system, its
  subject is a gerund, and it is one of the shortest sentences here. TWO SHAPES COST, and both
  defer the verb. A NOMINALISED INSTRUCTION makes the reader convert it before they can act —
  "Building the value outside the call and passing it in is what makes this go wrong" is "Do not
  build the value outside the call and pass it in". A CLEFT — "X is what does Y" — buys
  contrastive emphasis the plain verb already carries: "Reading is what loads it" is "Reading
  loads it", and the four words are the stronger claim. Name the verb they would type and the
  noun they would type it on. Where a second fact is owed it is a SECOND SENTENCE — "Every reactive
  value takes one" — never a clause hung off the first, because the two facts are then read at
  the same weight instead of one being smuggled past.
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
  refer to; "Probes: `pending`, `refreshing`, `done`, `success`, `streaming`, `error`" is not.
* **A heading that ENUMERATES names the whole set.** The line above is the shape a reader scans
  for, and that is exactly what makes a partial one expensive: it reads as the complete list, so
  a name left out of it is a name absent from the one line anybody checks. This rule was written
  because the example beside it was wrong — the probes heading named four and its table listed
  six, in the page and in this file, for as long as both had existed. Name every one, or make the
  heading a claim and let the table be the list.
* **The code under a heading answers that heading.** A section about `.abide` sugar showing a
  `.ts` file, or a section about the shape of a keyed memo showing its `tags` option too, reads
  as two subjects and teaches neither. `{% snippet %}` takes several anchors for this reason —
  pull the lines the heading is about, and if they are not one construct, say so with the
  elision rather than widening until they fit.
* **A heading names what an author WRITES, not a type they have not met.** "A `Transformer`
  normalises a value" is the type of an option spelled `transform`, so the reader scans for a
  word that is not in their file. Name the property, then introduce the type under it. `Reactive`
  and `Accepted` are fair — nothing else is spelled those.
* **A heading may not state an absolute the page then qualifies.** "A read never awaits" was
  false two sections above `{await invoice}`, and the reader who believes the heading is the one
  the page then contradicts. Say "by default" in the heading and put the opt-in under it.
* **A heading belongs to its page's subject.** On a page about caching, "A body that takes args
  is a keyed memo" is about memos; "A memo's cache is one entry per args key" is about the cache.
  Same fact, and only one of them answers why the reader is on that page.
* **A claim with no code beside it links out rather than being made.** Where the page does not
  demonstrate it, name the API in one clause and point at the page that does — "`invoice.refresh()`
  reloads. See Loading states." Prose evidence is for costs, which makes them credible.
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
  solve. Every TOPIC page is titled this way, and marketing follows the docs. An overview routes
  and a reference page enumerates, so each is titled for what it holds instead.

# Visual identity

The full token set is `packages/dogfood/src/ui/app.css`; it is the source, not a copy.

| | |
| --- | --- |
| Ground | A deep green-black in dark, a cool paper in light. Calm and technical — never black-with-a-neon-accent — `--paper`, `--ink`, `--muted` |
| Signal | Teal. Links, active nav, the BOTH-SIDES spine — `--signal` |
| Headings | Terracotta. Warm against a cold palette, and deliberately NOT the amber below — `--heading` |
| Amber | The SERVER side — the spine, and the response arrow beside it — `--warm` |
| Blue | The BROWSER side, the same way — `--cool` |
| Type | Space Grotesk for headings, IBM Plex Sans for body, IBM Plex Mono for code, captions and status |

A snippet renders in a 44rem column at 12px mono — about 81 characters before it scrolls. Past
that a sample is a thing to scroll rather than a thing to read, so the width is a property of the
SOURCE rather than of the block. **The number is the formatter's**: `coverage.test.ts` reads
`lineWidth` out of `biome.json` rather than restating it, because the copy that restated it drifted
and broke. What the check is FOR is the files biome does not reach — a markdown fence, a `.abide`
template — never a second opinion about how wide a line should be.

**Every length is a multiple of .25rem** — padding, gap, margin, width, height, inset, font-size,
line-height. The exceptions are the three things that draw a LINE rather than occupy space: a
border, an outline and a shadow, which are hairlines at any type size. Letter-spacing is exempt for
the same reason in the other direction — tracking is a ratio of the type it tracks, so it is em.
The type lands on four steps: .5rem for a micro label, .75rem for chrome, code and captions, 1rem
for prose, and 1.25rem and up for headings and stat values.

**A TIP is the documentation's own voice.** Teal-washed, with a mark on it, and it means the same
thing wherever it appears: an aside in prose, written `> [!TIP]`, and an annotation the
documentation adds beside something a reader is looking at. A reader is entitled to read every
pixel of a render as the app's output, which is why the documentation's own instrumentation sits
OUTSIDE the frame rather than inside it wearing a tip (40.21) — the request meter under an example
is that, and it is the arm's own count rather than a caption about one.

**An example leads with the running page, and the page is really running.** The render sits above
the tabs and stays there, and what it runs is the hand-written arm (40.19) against the network that
example names (40.20) — its wire fixture, or a hand-written server of its own where a frozen answer
cannot cover what a reader types. Requests shows that network rather than a screenshot of calls
somebody transcribed. Files, Bench and Tests are what a reader consults ABOUT
it. The thing an example is for is the thing that runs, and a reader who has to find a tab before
seeing one has been handed source to read instead of something to try.

A stub marker takes `--muted`. It marks an ABSENCE, so it takes the ground's own recessive tone
rather than a reserved colour, and it goes when the framework is written — which is why it has no
row here to inherit.

**The signature is the code-block spine.** Every snippet of SOURCE carries a colored edge and a
caption. THE EDGE IS THE SIDE AND THE CAPTION IS THE SYNTAX, and they are two facts rather than
one: `.ts · browser` says which of the two spellings is on screen and where it runs, where
`browser` alone said only the second and left a reader guessing between a name read by name and
`s()` — which are the two forms this whole design is about. A file path says both by itself.
Three colours over four seam words: `shared` and `abide` are BOTH SIDES, the seam deciding it
rather than the extension, so a `#shared/*.ts` takes the same edge a `.abide` file does. A block
that is not source — a shell transcript, a directory tree — carries no language and no caption,
having no side to name. A caption showing part of a file says so: `— excerpt`, because an address
a reader cannot open is a claim, and one that contradicts the same address on another page is a
claim that has already broken. It is the framework's central idea made visible, and it is the one
device to keep wherever the brand appears.

NONE OF THAT IS TYPED ANY MORE, on a page that has been converted. `{% snippet %}` names an
example and a line in it, and the caption, the language, the `— excerpt` and the colour are all
DERIVED from the address — so a snippet cannot claim a seam its path contradicts, and a sample
that drifts from the file fails the build rather than the reader. The four bare words are what a
page still carries until its example exists; they are a stage, not a second spelling.

# Status

| | |
| --- | --- |
| Real today | The workspace, the seams, the three measurement lanes, `docs/REGISTRY.md`, `docs/RULEBOOK.md`, `docs/DECISIONS.md`, and the documentation site |
| Not written | The framework — the compiler, the runtime, the server |
| Therefore | Every claim above describes a DESIGN. None of them may be phrased as something a reader can run yet |
