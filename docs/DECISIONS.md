# Decisions

Every road not taken, and what taking the other one would have cost.

## What this document is

A **decision record**. One entry per decision, and the entry answers exactly one question: *why is
it this and not the obvious alternative?*

## What belongs here, and what does not

| A statement | Goes | Because |
| --- | --- | --- |
| Why the design refuses an alternative | here | a maintainer reaches for the alternative otherwise, and nothing says no |
| What must hold | RULEBOOK.md | a requirement has a clause number |
| What a name is | REGISTRY.md | a signature is not a decision |
| Why a reader would want it | a guide in `packages/dogfood/content` | a user's why and a maintainer's why are different documents |
| A measurement | the harness | a number in prose is a number nothing re-runs |

## Format rules

These are immutable. A change to them is a change to what this document is.

1. **An entry names the alternative it refused.** An entry with no rejected alternative is a
   rationale, and a rationale belongs in a guide.
2. **An entry cites the clauses it decided.** That citation is what keeps a decision attached to
   the rule it produced, and a check refuses an entry with none.
3. **No clause is restated here.** Cite the number. A rule written twice is the drift all three of
   these documents exist to stop.
4. **No requirement keyword.** MUST, SHALL and MAY belong to RULEBOOK.md, and a check refuses them
   here.
5. **Entry numbers are stable.** A reversed decision is marked reversed in place, with the entry
   that supersedes it. A number is never reused.
6. **An entry states what it ASSUMED, where it rested on something.** A decision whose premise a
   later clause removes stays valid-looking in both documents — nothing contradicts it, and the
   reason it gave has simply stopped being true. An `Assumes:` line is what a later amendment can
   be grepped against, and a check refuses one naming a clause that is not live.

# D1. Two memo overloads rather than one with an optional parameter

**Refused:** a single `memo` signature taking `args?`.

**Because** the two forms hand back genuinely different things, and an optional parameter collapses
them into a type neither one is.

**Decides:** 11.1, 11.2, 11.3, 11.44.

# D2. No warning on a write to a memo

**Refused:** warning where an app writes to a computed value.

**Because** `memo(() => structuredClone(upstream))` and `memo(() => a + b)` are indistinguishable to
a compiler, neither having an lvalue — so the warning would fire hardest on the good pattern.

**Decides:** 11.9.

# D3. Only `pending` propagates

*Reversed by D69.*

**Refused:** propagating `refreshing` alongside it.

**Because** `pending` is monotone and derivable on the walk the body's reads already make, where
`refreshing` can start and finish without the value moving — so the only way to learn it is a
subscription per source, torn down and rebuilt every recompute, to drive a spinner. A derived
spinner reads the source's own probe instead.

**Assumes:** that `s.pending` falls once and does not re-arm — which 7.9 has not been true of
since D55, fifty-two entries later.

**Decides:** 11.20, 11.22, 11.23.

# D4. The key is taken before the schema runs

**Refused:** keying on the validated, normalised args.

**Because** a browser holds no copy of `args`, so a key taken after the schema is computed one way
on a server and another in a browser: every handler with a normalising schema would miss its seed
buffer and re-issue the call on hydration.

**Consequence:** a normalising schema changes what the body sees and never which entry it is, so
`{ id: 'ABC' }` and `{ id: 'abc' }` are two entries and nothing warns. Args that must collapse are
normalised by the caller.

**Decides:** 11.28, 11.29, 11.30.

# D5. Defaults are syntax, not schema

**Refused:** letting `.default(20)` in a schema participate in the key.

**Because** a schema default is post-key normalisation, so `getInvoices()` and
`getInvoices({ limit: 20 })` would land on two keys and the commonest args pattern there is would
double-load silently.

**Decides:** 11.31, 11.32.

# D6. A global cache has no eviction policy

**Refused:** a byte ceiling, and an LRU count.

**Because** measuring an arbitrary `Stored` costs the walk `identity` already declines to pay by
default, and an LRU would evict an entry a reader is mid-flight on. The bound is a number the app
knows and abide does not.

**Decides:** 11.37, 11.38.

# D7. A request-scoped read inside a global body is a build error

**Refused:** stating it as advice.

**Because** advice is remembered per call site, and this is what licenses deriving `cache-control`
from a global memo's `ttl` — not a promise the app made and might have broken, but a shape the build
refused to compile.

**Decides:** 11.39, 21.9.

# D8. A room has no revoke and no clear

**Refused:** a way to remove a published message.

**Because** a ring bounded by `tail` and `ttl` that a process restart drops wholesale cannot promise
"never served again" — so anything that must genuinely not be served again is durable, behind an rpc
where a delete is a delete. Removal is an ordinary publish of a tombstone.

**Decides:** 9.19, 9.20.

# D9. An effect that threw stops its watch

**Refused:** re-running it.

**Because** one that throws once usually throws every run, and a watch re-running into the same throw
is a loop with a log line per iteration. The app re-establishes it if the failure was transient.

**Decides:** 12.9.

# D10. Only `pending` and `refreshing` have a free form over a selection

**Refused:** free `done`, `success` and `error`.

**Because** "is anything loading" is the only question that aggregates without a second rule: `done`
and `success` over a set are genuinely ambiguous between any and all, and an aggregate `error` would
have to decide which failure to hand back.

**Decides:** 13.2, 13.5.

# D11. Tracking is synchronous

**Refused:** propagating the subscriber across `await`.

**Because** that puts its cost on every promise in the process, and makes over-subscription the easy
mistake — the failure that leaves the output right and is visible only by counting wake-ups. The cost
of the rule is one variable set and restore, and a compiler warning where a read sits under an await.

**Decides:** 14.13, 14.14.

# D12. A declared refusal defaults to 400

**Refused:** defaulting to 500.

**Because** a declared refusal is by construction an expected answer, and 500 is the one status
certainly wrong for it — an OpenAPI response a generated client reads as a server fault, a status a
model retries instead of re-planning, and a page in front alerting on it.

**Decides:** 15.4.

# D13. Two named refusals and no more

**Refused:** declaring names for the rest of what abide raises.

**Because** a name is public surface forever, and 403 on an origin mismatch, 413 over-size and 504 on
a timeout have no data to narrow to — so they stay undeclared at their status.

**Decides:** 15.10.

# D14. The `GET` arm is read off a brand

**Refused:** dispatching on the handler's structural shape.

**Because** a `Channel` is a bare `(args?) => Room` and is therefore structurally the plain-function
arm — so a channel would be wrapped as a one-shot read rather than served as a room, and the
generated surfaces would publish an unbounded room as a tool.

**Decides:** 16.5.

# D15. A rung runs on an in-process call too

**Refused:** running middleware only on the wire.

**Because** a page renders on both sides, so its render-time read of a handler is an ordinary caller
— and a rung that authorises on an id in the args would be reachable by a browser and missed by the
render. Authorisation is the one thing with nowhere else to live.

**Decides:** 16.12, 16.13.

# D16. The onion is composed once

**Refused:** folding the chain per call.

**Because** folding allocates one closure per rung to rebuild a chain that never changed, and a chain
holding a request would keep that whole scope alive for the life of the process.

**Decides:** 16.15, 16.16.

# D17. The client wrapper is generated, not shaken

**Refused:** deriving the browser's module from the server module by tree-shaking.

**Because** "no server code shipped" is then a property of the build rather than an optimizer's
outcome, and a module-level side effect in an rpc file cannot reach a browser at all.

**Consequence:** a page has no direct server read. Every render-time read goes through an rpc,
including one the browser will never issue — which is what the seed buffer answers.

**Decides:** 16.30, 16.31.

# D18. `refuse` carries no data

**Refused:** an options bag for data on an undeclared refusal.

**Because** data undeclared has no type on the other side, so `refuse.typed` with a schema is the
only place it can mean anything.

**Decides:** 17.9.

# D19. `clientPublish` is the socket's option, not the channel's

**Refused:** a publish gate on the channel.

**Because** a socket accepts frames at a room nobody named, where the other way into a room from
outside is a `POST` that exists only because an app declared an rpc that publishes into it — and that
declaration is already the intent a flag would restate.

**Decides:** 18.7.

# D20. A schema returns rather than predicates

**Refused:** `(value) => boolean`.

**Because** a boolean cannot normalise, and a `false` stored as the value is the silent version of a
refusal.

**Decides:** 19.3, 19.4.

# D21. Coercion belongs to the pipeline

**Refused:** coercing inside the schema.

**Because** that asks every form of `Schema` to coerce, which the native `validateJson` does not do
and a Standard Schema does its own way.

**Decides:** 19.8, 19.9, 19.10.

# D22. A derived schema widens silently where inference fails

**Refused:** refusing the file.

**Because** valid TypeScript has to compile. The cost is that an unresolved annotation degrades to a
wider schema with nothing saying so, and the repair is to declare `schema` where the derivation
cannot be trusted.

**Decides:** 19.13.

# D23. `clients` is a listing, not a boundary

**Refused:** reading any key of `Clients` as access control.

**Because** `openapi: false` makes an address undocumented rather than unreachable, and `mcp: false`
and `cli: false` withhold a listing while the http address answers exactly as before. Who may call is
a rung's decision. `ui` is the one key with teeth, being the only one resolved at compile time.

**Decides:** 20.3, 20.4.

# D24. `route` is members, not a composite

**Refused:** one `Reactive` whose value is a route object.

**Because** the members change at different rates and are read separately, so a composite would wake
every reader of the url twice per navigation for a spinner's sake, and rebuild an object nobody asked
to be rebuilt.

**Decides:** 23.1, 26.1.

# D25. `health` and `principal` resolve collisions in opposite directions

**Refused:** one merge rule for both.

**Because** `health` is an app describing itself and its fields win, where `principal` is abide
stating what it verified and the baseline wins. Letting an app overwrite `authenticated` would let a
resolver claim an authentication the server never accepted.

**Decides:** 25.3, 26.4.

# D26. A principal is stateless

**Refused:** a server-side session store and a revocation list.

**Because** the one lookup per request that costs is the app's to pay. A ban therefore takes effect
within `ABIDE_PRINCIPAL_TTL` unless the claims carry a version for `onPrincipal` to check.

**Decides:** 26.17.

# D27. A closed channel skips the measurement, not just the publish

**Refused:** gating only the write.

**Because** a detection that is O(n) with the channel open must be one boolean read with it closed —
so the compare is not run, the counter is not kept, and the bookkeeping is not built.

**Decides:** 28.7.

# D28. A binding holds rather than reads

**Refused:** reading at a binding.

**Because** the rule is chosen so that hoisting is a no-op: `memo(() => route.url)` and
`memo(() => { const u = route.url; return u })` are the same memo. Under a rule where the binding
read, lifting a subexpression would change what the memo depends on.

**Decides:** 31.3.

# D34. One JSON Schema spelling is probed, not a registry of vendors

**Refused:** a table of schema libraries inside the framework.

**Because** a registry needs a fourth entry the week a fourth library exists. One zero-argument
probe covers zod, arktype and valibot, and an app whose library spells it otherwise adapts it in a
line.

**Decides:** 20.11.

# D35. A path write copies, and the copy is not optimised away

**Refused:** mutating in place where the value is not shared.

**Because** a `tail` past the default is for replaying past values — an undo stack is the shape —
and replaying a value that was mutated underneath you replays nothing.

**Decides:** 31.11.

# D36. An interpolated `style` lowers to `style:prop`

**Refused:** building the attribute as a string and sanitising it.

**Because** `setProperty` parses one value and cannot be made to accept a second declaration, so an
injected `;` yields an invalid value rather than a new property. The safety is structural rather
than a filter that has to stay ahead of its input.

**Decides:** 32.23.

# D37. The batching unit of a fill is the flush

**Refused:** one fill per production.

**Because** a pair per row is two elements parsed and one script run per row — five hundred rows
costing a thousand elements and five hundred executions of a byte-identical script to deliver five
hundred list items.

**Decides:** 35.10.

# D38. `abide mcp` is a disposable bridge, not the app

**Refused:** putting `abide start` where a model client spawns a stdio server.

**Because** whoever spawns a stdio server owns its lifecycle: closing a chat window would stop the
app, two clients would race for one port, and a reconnect would restart a server nobody asked to
restart.

**Decides:** 38.14.

# D39. The seed answers the client's own request

**Refused:** embedding the render's answers in the document.

**Because** the buffer can then be released on a timer rather than held in hope, and hydration can
re-execute setup instead of adopting a serialized result — one runtime and one code path on both
sides.

**Consequence:** the round trip is still made and only the handler's work is saved, so a warm visit
with a cached bundle pays the fetches in full. That is what makes the browser cache load-bearing
rather than a bonus.

**Decides:** 41.6, 41.7, 41.8.

# D40. The example runs the hand-written arm

**Refused:** a state machine of authored HTML snapshots.

**Because** every claim such a machine made about work — a request count, a coalesced load — was a
number somebody typed and kept in step by hand, and the arm in `vanilla/` is real code that really
caches and really counts. What the meter reports is now what happened.

**Consequence:** the Files panel shows `.abide` while the frame runs the arm, and that the two are
equivalent is a claim only the controls are checked against. It stands until there is a compiler.

**Decides:** 40.19, 40.20, 40.21, 40.22.

# D41. A demo per behaviour, counting itself

**Refused:** one realistic problem per page, with every section a snippet cut out of it.

**Because** that shape sizes the example by how many names the page claims, and it puts the
evidence somewhere the render is not. A page teaching six behaviours had to invent a domain
needing all six, so a reader spent attention on customers and exchange rates to reach a claim
about caching — and the claim itself lived in an authored bench row rather than on screen. A demo
that counts its own work makes the number the reader's to check, and the domain shrinks to
whatever the count needs.

**Consequence:** the arm has to hold the invariant the card claims, because the arm is what runs.
The hand-written cache and the hand-written dependency list are no longer only what the ratio is
against; they are what keeps the render from contradicting the page.

**Decides:** 40.23, 40.24, 40.26, 40.27.

# D42. Four named apps, rather than a situation per card

**Refused:** letting each example invent whatever world demonstrates its clause most directly.

**Because** an invented world optimises for the mechanism and not for the reader, and the drift is
one way: a card about tracking becomes two cells named `count` and `unrelated`, which demonstrates
the clause perfectly and gives nobody a reason to care. Naming the apps first makes the pattern the
thing that exists and the clause the thing it lands on. Four also bounds the vocabulary a reader
carries across a section, where a situation per card is a new world per card.

**Consequence:** an app abide fits that none of the four reaches is a gap in the table before it is
a gap in the documentation, so the table is a claim about the surface and not only a writing aid.

**Decides:** 40.28, 40.29, 40.30.

# D43. A returned `Reactive` is adopted, not stored

**Refused:** letting a `memo` body's returned `Reactive` be that memo's value.

**Because** the wrapper is compulsory rather than a matter of taste. A setup body does not track
(14.7), so a bare call registers nothing and never follows its arguments, and
`memo(() => call(args))` is the only spelling that does. A wrapper that STORED the call would make
every one of those required wrappers a second level: the name would be the box, and the load would
be one call further in, at every read and every probe on every page. And the probes would be the
WRAPPER's — a wrapper settles the instant its body returns, which is synchronously, so `pending`
on it reads false for the whole of the load it wraps. The loading states are most of what the
design is for, and the wrapper nobody can avoid writing would be what breaks them.

**Consequence:** an adopting memo forwards members it cannot know the shape of (11.15), so the
outer is a delegation rather than a fixed face. That is the price of the required wrapper costing
nothing where it is read.

**Decides:** 11.12, 11.13, 11.15, 11.17, 11.18, 11.19.

# D44. A card proves a claim, rather than demonstrating a name

**Refused:** treating an example as a place a name is shown working.

**Because** the two produce the same code on an easy page and come apart on every hard one, and
when they come apart the demonstration is the version that reads fine. A card built to show that
`transform` runs is correct, and is also `state(v, { transform })` with an extra concept: nothing
in it needs the memo it is filed under. What that card cannot do is fail visibly, so it survives
several rounds of better labels while proving the wrong thing. A card built to prove a claim has
somewhere to be wrong, and a heading it can be held against.

**Consequence:** a card that does not land is read as a diagnosis rather than a draft — either the
heading names a mechanism where a capability was wanted, or the code demonstrates the name instead
of what the name is for. Rewriting is the repair for neither.

**Decides:** 40.31, 40.32, 40.33.

# D45. A work claim is asserted, not rendered

**Refused:** a counter in the example's own source, rendered beside the values (40.25, withdrawn).

**Because** the counter is code, and it is code in the one file the reader opens. A card proving
that a body runs once carried a cell to hold the count, a line to raise it and a row to show it —
three additions to a source whose whole job is to be short enough that the claim is visible in it.
The count was evidence for a reader who had already stopped reading. What it was protecting
against is real and does not go away: the output is identical whether the work happened or not,
so nothing about the page can show it. That evidence moves to the example's spec, where a contract about
work belongs, and the page keeps only what the app would show.

**Consequence:** a claim whose work touches no transport is now asserted and not observable — the
two cards over a local body hold their invariant with nothing watching. A count that is DOMAIN
data survives the change and is better for it: a record's own view count is the same proof, told
by the product.

**Decides:** 40.32.

# D46. Nothing between a heading and its card

**Refused:** a paragraph introducing the card, between the heading and the card.

**Because** a card already introduces itself twice — the title is the signature and the summary is
the situation, and both sit above the render where a reader meets them on the way in. A paragraph
before that is a fourth voice with no job left, so what it writes is one of the other three again
in different words, and the reader has read the claim three times before seeing anything run. The
convention it came from is older than the card: copy had to introduce a bare fence, because a bare
fence says nothing about itself.

**Consequence:** everything a section has to say beyond the claim now comes after the card, where
the reader has the thing in front of them. That is a harder place to write, and the reward is that
what survives is only what the card could not show.

**Decides:** 40.34, 40.35.

# D47. A card's source carries no argument

**Refused:** explaining a card in the comments of the file the card shows.

**Because** a comment long enough to make the argument is the argument, and then the code beside it
is an illustration rather than a proof — which is 40.31 failing quietly, in the one place it is
hardest to notice. The adoption card reached twelve comment lines above a two-line memo, and the
twelve were carrying the claim. They also said what the copy under the card already said, so the
page argued the same point twice and the reader met the weaker one first.

**Consequence:** a comment that survives is a pointer rather than a paragraph — which line the
claim turns on, where two near-identical bodies differ. Everything else moves to the copy, where
it is read once and where a stale one is visible.

**Decides:** 40.36.

# D48. A memo's args gate is `args`, not `schema`

**Refused:** one name for the gate on a value and the gate on a call's arguments.

**Because** they are different gates on different things at different moments, and the collision
made two clauses contradict: 4.3 has a `schema` running on the settled value, and 11.43 had one
checking `Args`. Both were right about their own producer and neither could be read as general. A
`channel` already carries both gates and already names them apart, so the vocabulary existed and
`memo` was the one name out of step. With the rename, `schema` gates the value everywhere it
appears, which is what 4.3 and 4.4 say, and `args` gates the call. What a memo's own `schema` then
gates is D50's.

**Consequence:** `args` reads as unspellable on the unkeyed overload for the plain reason a
channel's does, where `schema` had to be refused there by a clause of its own.

**Decides:** 11.43, 11.44.

# D49. `Reactive` carries its `Accepted`

**Refused:** a `Reactive` of three parameters, whose `s.set` reaches an unbound `Accepted`.

**Because** the member referred to a name the type did not declare, so a write through a `Reactive`
was typed `unknown` — on a value whose whole point is the type surviving the trip. A memo storing a
`Map` built from an array of rows took a `Map`, a string or anything else without complaint, and
through a prop there was no factory nearby to infer from. The slot was not missing on purpose; the
type was written before `transform` could retype and never grew the parameter that made it legal.

**Refused also:** putting `Accepted` first, uniform with the factories. Almost every annotation in
the documentation is one parameter, and that parameter means what the value READS as — a
consumer's `Reactive<Invoice>` means "reads an invoice", not "reads and writes one". Leading with
`Accepted` silently narrows every one of them and rejects exactly the transformed values the
parameter exists for.

**Consequence also:** `Memo` carried the same unbound name one level up, and is repaired with it.

**Consequence:** a factory names its input first and a result type names its output first, which
reads as two conventions and is one — the first slot is what whoever reads that signature came
for. `Rpc` already did this, so `Reactive` was the only result type short a slot rather than the
only one out of order.

**Decides:** 4.13.

# D50. A memo carries a value gate

**Refused:** withholding `schema` from `memo`, its value being its own body's output rather than
something handed in.

**Because** a body that parses a fetch is the same untrusted boundary a state's initial value is,
and the check then lives inside the body where nothing collects what it refused — 1.4 does that
only for a declared gate. The withholding is also two concepts where one would do: `schema` reads
as the gate on the way in for every other producer, and `memo` was the one a reader had to remember
it was absent from.

**Decides:** 11.53, 11.54.

# D51. A channel's publish and its message are two types

**Refused:** pinning a channel's `Stored` to its `Accepted`.

**Because** the ordinary thing a publish wants — a server-minted id, a received-at stamp — changes
the type, and a channel was the one producer that could not spell it, where `state` carries the
pair and `memo` carries it as `Computed` against `Stored`. The pin also left `transform` on a
channel able only to refuse, which is half a name.

**Decides:** 9.10.

# D52. `config` is a memo

**Refused:** config as its own mechanism, carrying its own invalidate.

**Because** it already had every part of one: a body in 27.3, a cache behind it, and a trigger over
that cache. The bespoke version was a second spelling of 7.2, which is what 13.4 refuses
everywhere else. As a `global` memo it also inherits 11.39, so a config body reaching for the
request is a build error rather than a convention nobody wrote down.

**Consequence:** `Config` is declaration-merged like `Bag` and `Shared`, which drops the type
parameter every `config()` call site used to carry.

**Decides:** 27.10.

# D53. `tail` is over `Stored`

**Refused:** `tail` over `Produced`.

**Because** a chunk is a piece of one value rather than a past one, so a ring of chunks replays a
fragment nobody can use, and a streaming value had no history at all. Under 9.3 a streaming
producer's `Stored` comes into existence at close, which is the unit a reader means by "the last
few".

**Consequence:** the ring and the live cursor carry different units, so a block over a room names
its replay depth where one used to be given to it. A feed with no end models as a channel, which
9.5 already asks a producer to declare.

**Decides:** 2.11, 6.3, 8.6.

# D54. Expiry is timed, one timer per ring

**Refused:** lazy expiry alone.

**Because** a ring drains on a read, and the two things that outlive a request — 11.36's
process-wide cache and 9.18's room — are the ones nothing reads while idle, so 9.17 had no event
that could fire.

**Refused also:** a timer per production, which is a heap insert on every write and makes 6.2
false. Productions in one ring share a `ttl` and arrive in order, so the earliest expiry is always
the head, and one timer answers for all of them.

**Consequence:** 6.5 is the correctness half and 6.9 the reclamation half, so a late timer is never
a stale read.

**Decides:** 6.9, 6.10, 11.55, 11.56.

# D55. An invalidated value reads as pending

**Refused:** reporting `s.refreshing` for the load an `invalidate` caused.

**Because** that left the two triggers differing only in eagerness, where what they claim differs:
a refresh says the held value is good, an invalidate says it is wrong. It also misses the case the
narrow reading of `pending` was built to exclude — a component mounting after the invalidate has
painted nothing, so there is no flash to protect and a spinner is what the reader wanted.

**Refused also:** clearing `s.done` at the `invalidate` rather than at the load that follows. A
value nothing goes on to read would then sit not-done for as long as it existed, which describes
no state it is in — and the flip would itself be a node moving on a call 7.3 keeps free.

**Consequence:** `pending` reads as nothing trustworthy to show rather than nothing at all, so 3.4
opens a sink over a stale value on a server render.

**Decides:** 7.8, 7.9, 7.10, 7.11, 7.12.

# D56. `share` is a subtree's, not a process's

**Refused:** one shared registry per request on a server and per process in a browser.

**Because** two sibling subtrees that each want `'id'` for the row they render collide on it in
silence, and neither can see the other's key. The global that scoping gives up is better served by
what the language already has: a module exporting the value, imported by whoever needs it, typed
and needing no key and no registry at all.

**Decides:** 10.5, 10.6, 10.7.

# D57. A refusal's message is formatted at construction

**Refused:** a lazy `message`, computed when it is read.

**Because** 15.7 makes a `Failed` structural, and a getter survives neither `JSON.stringify` nor
`structuredClone` — so the same refusal would read one way in process and another over a wire,
which is the one property the type exists for. It also relocates the throw to whoever reads the
message, which is a log line or a template, so a formatter bug surfaces as a render failure rather
than at the refusal that caused it.

**Refused also:** an interpolation syntax over the data. It cannot throw and could be checked at
build, and it is a language where a function is what the platform already has.

**Decides:** 15.13, 15.14, 15.15.

# D58. Cookies wake by name

**Refused:** one `Reactive` over the whole cookie map.

**Because** every reader of any cookie would then wake on every cookie, which is what D24 refuses
for `route` and for the same reason. Reading by name also has somewhere to put the browser's own
event: a `CookieChangeEvent` names what changed, so what to wake is decided by the platform rather
than by diffing a snapshot.

**Consequence:** the surface does not move — `cookies` stays one call handing back a map, and what
changed is which reads join the flow.

**Decides:** 22.6, 22.7, 22.8, 22.9.

# D59. A store round-trips `Stored`

**Refused:** a store over `Accepted`, whose restore re-runs `schema` and then `transform`.

**Because** a streaming producer has no `Accepted` at all — nothing was written in, and 8.9 hands
the store the accumulation, which is the `Stored` 9.3 materialised at close. Re-running the
shaping was wrong on its own terms too: a `transform` that stamps a received-at would restamp on
every restore, and a lossy one has nothing left to re-derive from.

**Consequence:** what guards a restore is the `get` the app wrote, which was already parsing
whatever the store hands back. A shape an older version of the app wrote is a miss, per 8.15, and
falls back to the initial value rather than becoming a refusal the value has to carry.

**Decides:** 8.5, 8.15.

# D60. A handler's return may not carry a `Reactive`

**Refused:** letting it serialize and lose the member.

**Because** `JSON.stringify` drops a function, so the member never arrives and nothing reports that
it did not — the caller gets an object one key short of the type it was promised, after 16.32 has
already answered 200. Inside a `memo` the same nesting is fine, a nested value being read where it
is used; the loss happens at the transport, which is where the return type makes it visible.

**Decides:** 16.43.

# D61. `throttle` and `debounce` cap a change, not a revalidation

**Refused:** a second pair of options for how often a value recomputes, beside the pair for how
often it reloads.

**Because** the two are one question — how often may this value change? — and the answer differs
only in what drives the value: a trigger on a memo over a load, a chunk on one over a stream, a
write on a state, a publish on a room. A second pair would also have needed both shapes, leading
edge and trailing, so refusing it saves four names rather than two. The pair moves to
`ReactiveOptions` with the widening, which is what makes `throttle` on a `state` written from a
scroll handler spellable at all.

**Refused also:** letting a window drop what it collapsed. A cursor over a capped room would lose
messages, and 18.16 keys that block by sequence number, so the gaps would read as reordering rather
than as loss. A window collapses a batch into one delivery instead, which is 35.10's shape with a
window where the flush is — and for a scalar read the batch is the latest value, so one rule reads
as two behaviours.

**Consequence:** `s.refreshing` answers "an update is owed" rather than "a reload is in flight",
which is what a reader wanted from it either way; where the difference matters, `s.streaming` and
the source's own probes carry it.

**Decides:** 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17, 5.18, 5.19.

# D62. Health answers inside the app's middleware

**Refused:** answering `/__abide/health` outside the middleware, so that a load balancer reaches
it before an app's own rungs run.

**Because** 20.8 is the whole of what makes `/__abide/**` predictable — one lane, and every
address in it. An address answered outside is a second lane with one member, and that member is
the one an operator most needs to reason about while the app is failing. The exemption also
decided an app's authorization for it: an app wanting health open had nothing to write, and an app
wanting it closed had no way to say so.

**Consequence:** middleware that refuses an unauthenticated caller refuses health too, and letting
it through is a line in that middleware rather than a property of the address. What health answers
with is unchanged, 21.5 governing that.

**Decides:** 20.8.

# D63. `refuse` names its refusal, and the count says three

**Refused:** leaving `HttpError` out of the names 15.10 counts, on the ground that an undeclared
refusal is not a declared name.

**Because** the name reaches a caller whatever the clause says. It is in the wire body, in the
OpenAPI default response and in the MCP error entry, so a reader checking 15.10 against what abide
sends found three names where the clause promised two. "Undeclared" describes where a refusal may
be narrowed, not whether it exists.

**Consequence:** three names rather than two. The third still carries no data and still enters no
`Failures` union, so it remains the one a caller cannot narrow to — which is what 17.9 refuses an
options bag for.

**Decides:** 15.10, 17.8.

# D64. A room goes when its last subscriber does

**Refused:** holding a room until its retention has drained as well as its subscribers.

**Because** `ttl` defaults to infinity on a channel, so the second condition never came true and no
room was ever reclaimed. What read as a bound was one only for an app that had set a finite `ttl`,
and nothing required one — leaving a process-wide table with a permanent entry per key anything had
ever published to, in a design that refuses size-based eviction elsewhere on principle.

**Consequence:** navigating away and back finds an empty room rather than the tail it left. History
past the ring was already app data behind an ordinary rpc, per 9.13, and the cursor joins the two
without a gap.

**Decides:** 9.17.

# D65. Both bare triggers reach the process-wide entries

**Refused:** a bare `invalidate` reaching every `global` `memo` while a bare `refresh` may not.

**Because** the asymmetry made the safer-sounding word the wider one, and the narrower word the one
that blanks a reader. 13.7 already decides what a bare `refresh` costs — it reloads only what
something subscribes to and marks the rest — so at this width the pair differ in what a subscribed
reader sees rather than in what they reach. On a server nothing subscribes at all, per 14.12, so
the two were already one call there.

**Consequence:** a bare `refresh` on a reconnect reloads what is on screen and marks the rest,
which is what that path wanted. The bare `invalidate` keeps being the one that drops what
stale-while-revalidate would have served.

**Decides:** 13.7, 13.10.

# D66. Adoption forwards every probe

**Refused:** forwarding `s.pending` alone, on the reading that 11.20 governs adoption as well.

**Because** 11.20 governs a different mechanism, and the two had one word between them. Adoption is
delegation to the single `Reactive` a body returned, and an outer answering only one of its probes
would report `s.done`, `s.success` and `s.error` about a value it is not the face of. Propagation is
derivation from the values a body read, where a probe per source is a subscription per source, and
11.22 refuses that cost for all but one of them.

**Consequence:** 11.19 stops reading as a restatement and becomes the interaction it always was — an
adopting memo takes `s.pending` from what it adopted rather than from what its body read. The two
nouns are in the Terms table, so a later clause cannot pick either up by accident.

**Decides:** 11.13, 11.57, 11.58.

# D67. A read throws for a failed producer and for nothing else

**Refused:** a read that never throws, leaving every refusal to `s.error`.

**Because** a `{:catch}` needs something to catch, and 4.10 already decides that a refused write is
not it. A failed producer with nothing landed is the one case holding no value to hand back and a
refusal that explains the absence, so it is the case the throw is for. Returning `undefined` there
would make an empty value and a failed one one read.

**Consequence:** the two clauses beside it stop being exceptions to a permission and become the
boundary of a requirement — 2.4 for a write the gates refused, and 2.5 for a reload that failed over
a value still being served, which has something to serve and so falls outside 2.3 on its own terms.

**Decides:** 2.2, 2.3.

# D68. The ring is the window's buffer

**Refused:** a buffer beside the ring holding what a window collapsed.

**Because** it would be a second retention with no option naming it and no bound on it, in a design
where `tail` is the one number saying how much is kept. It would also make raising `tail` cheaper
than leaving it at the default, since the default would be the size that needed the hidden buffer
most — and 6.2 refuses to put retention's cost on a write.

**Consequence:** a capped value drops what its retention cannot hold, exactly as an uncapped one
does, and D61's second refusal narrows to what it can still support: the window collapses rather
than drops, and the loss belongs to `tail`. So a throttled room left at the default serves the
latest message and loses the ones between it, and the repair is the number that already means this
rather than a second one.

**Decides:** 5.12, 5.13.

# D69. Three probes propagate, derived on the read

**Reverses:** D3, whose premise 7.9 removed.

**Refused:** propagating `s.pending` alone, and deriving it at recompute.

**Because** deriving at recompute cannot answer for a source that moved without producing. 7.2 and
7.3 have `s.invalidate` drop the cache without changing the value and without sending a request, so
11.5 gives the memo no recompute — and a propagated probe derived at the last one reads false for
the whole reload window, which is exactly the window a reader wanted it for. Deriving on the read
that asks fixes that, and it costs no subscription, the source list being the one tracking already
keeps. That removes the cost D3 refused `s.refreshing` on, so the exclusion loses its reason.
`s.done` follows because 7.12 already moves it with the same state, and a value reporting `pending`
and `done` at once describes nothing it is in.

**Refused also:** propagating the other three. `s.error` cannot, because `Failures` does not — a read
inside a body widens no union, so a propagated refusal would sit unnarrowable by `s.isError` at
every reader, and 4.12 wants a failed revalidation invisible where the value still serves.
`s.streaming` would be false: 1.3 makes `Produced` this producer's own unit, and a memo yields one
value per recompute rather than chunks. `s.success` is orthogonal by 3.10 and 3.13.

**Consequence:** the split is no longer an exception with one member. The three probes about
whether a value is ready are downstream of its sources; the three about what the value is are not.

**Assumes:** 7.2, 7.3, 7.12 and 11.5, which together are why a recompute is not where a probe can
be derived.

**Decides:** 11.20, 11.22.

# D70. A body runs to completion against unlanded sources

**Refused:** deferring a `memo` body until the values it reads have landed.

**Because** the source list is a result of running rather than an input to it. 14.11 has a
`Reactive` push its own subscriber when it evaluates and 14.3 makes the body a tracked context, so
what a body reads is discovered by executing it — and 14.13 is the tell, a read after an `await`
registering against nothing once the stack has unwound. So a first evaluation has no list to
consult, a conditional read makes the previous run's list the wrong list, and aborting part way
leaves every source past the abort undiscovered.

**Refused also:** throwing a sentinel from an unlanded read and re-running, which escapes the
bootstrap. It would collapse "not yet" and "failed" into one control-flow path, where 2.1, 2.2 and
2.3 keep them apart, and it serializes: each abort discovers one more source, so a body reading
three unlanded values needs three passes against 41.2's one. On a server there is no mechanism for
it at all, 14.12 registering no subscriber to wake a retry with.

**Consequence:** running to completion is what makes the single parallel start possible, and a body
computing on `undefined` is its price. What keeps that price invisible is 11.20.

**Assumes:** 2.1, 2.2, 14.3, 14.11, 14.12, 14.13.

**Decides:** 41.2.

# D71. A provisional run mints nothing

**Refused:** letting a body that read an unlanded value produce like any other run.

**Because** an unlanded read is falsy, so a branch on one takes its `else` — and half the time that
is the privileged arm. `isAnonymous ? getPublicView() : getPrivateView()` issues the private call
for a caller nothing has authenticated yet, and every clause carrying a value onward is written
over a production: 11.13 mirrors one into the ring, 8.8 hands one to the store, 4.7 materialises
one through `transform`. So an answer the request had no right to reached retention and the app's
own storage. 11.39 had already closed the widest form, refusing a `global` body that reads
`principal`, and left the store form open.

**Refused also:** making the diagnostic an error rather than a warning. A body calling a helper
that branches is out of reach of any syntactic check, and an error that misses the indirect case
teaches a reader that the direct one is the whole hazard.

**Consequence:** the wrong branch's call is still issued, D70 being why it cannot be deferred, and
what stops that is the author spelling the gate — `{await}` per 32.2, or `s.settled` per 2.7. The
framework's half is that nothing a provisional run touched is retained, stored, shaped or served,
and that no second mechanism is needed for it: every path downstream already runs per production.

**Assumes:** 4.7, 8.8, 11.4, 11.13, 11.39.

**Decides:** 11.59, 14.15.

# D72. `private` is the directive, and `ttl` is the duration

**Refused:** deriving the `public` or `private` directive from the handler's authorization rung.

**Because** nothing can read one. A `Middleware` is an opaque function, and no name distinguishes a
rung that authorizes from one that logs, so the rule named a mechanism no implementation could
find.

**Refused also:** deriving `public` from `global` in its place. 11.39 does stop a `global` body
reading `request`, `principal`, `cookies`, `csp.nonce` or `route`, so its answer is the same for
every caller — but ACCESS IS A DIFFERENT AXIS FROM VARIANCE. 11.39 constrains the body and not the
handler's rungs, so a `global` memo behind an authorizing rung serves caller-invariant content to a
restricted audience, and `public` would let a shared cache hand it to a caller who never passed
that rung. The direction abide cannot detect is the unsafe one, so it is not the one to default to.

**Refused also:** dropping the `max-age` derivation along with the directive. The duration is
already stated once as `ttl`, and a second spelling in a `ResponseInit` is the drift the derivation
exists to stop. `private` with a derived `max-age` is a browser cache rather than a shared one,
which is the half that needed no permission.

**Consequence:** an app whose global answer really is open says `public` itself, per 21.4 — the
direction where being wrong is visible on the endpoint that chose it.

**Assumes:** 11.39, 21.4.

**Decides:** 21.9, 21.10.

# D73. A seed-buffer miss is a mismatch

**Refused:** answering a miss from the network.

**Because** it hides the divergence it is evidence of. 41.7 re-executes every setup body on the
client, so a call the seed buffer cannot answer means the client took a path the server did not —
a non-deterministic body, or a branch decided on something that moved. Going to the network repairs
that render and says nothing, so the same page pays a round trip on every load and nothing reports
why.

**Consequence:** 41.11 already decides what a mismatch costs — the enclosing block rather than the
page, with a warning on `abide:hydrate` — so this needs no machinery of its own. A body reading the
clock or a random gets a defined outcome rather than an undefined one.

**Assumes:** 41.7, 41.8, 41.11.

**Decides:** 41.13.

# D74. A named value reloads; a sweep still spares what nobody reads

**Refused:** `s.refresh` degenerating to `s.invalidate` where nothing subscribes.

**Because** it made one call mean two things by a condition nothing can observe. Subscription is
whatever is mounted at that instant, so the same button gave stale-while-revalidate with a
disclosure open and a blanked read with it closed, and a reconnect firing a tick either side of an
unmount decided between them. 7.8 is what made the difference visible rather than academic: the
degenerate form marked the value stale, so the next read reported `s.pending` under 7.9 and the
page a refresh exists to keep intact went blank.

**Refused also:** stopping the degenerate form marking stale instead, which removes the difference
by making the call do nothing at all. A reader who pressed reload would get neither a load nor a
mark, and the value they opened next would be the old one with nothing behind it.

**Consequence:** the split is by cardinality, along 13.1's own three forms. Naming one `Reactive`
reloads it, the caller knowing exactly what they named; a keyed `Memo`, a set of `tags` and the
bare sweep keep 13.7, so a reconnect still costs what a reader is holding and marks the rest. The
price is a load with no reader where an app names a value nothing is showing.

The bare form is named in 13.7 rather than left to the phrase "over a `Selection`". 13.1 admits
three things and none of them is the absent argument, so the sweep a reconnect actually makes was
governed by nothing on a literal read — which is the one call this entry most needed bounded.

**Assumes:** 7.8, 7.9, 13.1.

**Decides:** 7.14, 13.7.

# D75. An uncaught throw is a fault, not a refusal

**Refused:** answering it as a `Failed`, so that a caller can narrow it by name.

**Because** a refusal is an answer the handler chose and a fault is what nothing chose. D12 keeps
500 away from every declared refusal for that reason, which leaves it as the one status that says
the app did not get to decide — and a name minted from a bug is public surface forever, for a
condition no app designed and no caller can do anything with. A client narrowing on it branches on
the shape of a stack trace, which is free to move in the next patch.

**Assumes:** 15.1, 15.4.

**Decides:** 16.45.

# D76. The raw form is a shape, not an escape hatch

**Refused:** `rpc.raw` going straight to the network, past the rungs and past the seed buffer.

**Because** the raw form is reached for to see the `Response` itself — a header, a status, a body
read by hand — and none of that is a reason for it to be a different call. One that skipped the
seed buffer would fetch again during hydration for an answer the document already carried, and one
that skipped the rungs would be the single call in an app that nothing guards.

**Assumes:** 16.12, 41.8.

**Decides:** 16.46.

