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

# D4. The key is taken before the args gate runs

**Refused:** keying on the validated, normalised args.

**Because** a browser holds no copy of `args`, so a key taken after the gate is computed one way
on a server and another in a browser: every handler with a normalising schema would miss its seed
buffer and re-issue the call on hydration.

**Consequence:** a normalising gate changes what the body sees and never which entry it is, so
`{ id: 'ABC' }` and `{ id: 'abc' }` are two entries, which 11.63 leaves unwarned. Args that must
collapse are normalised by the caller.

**Decides:** 11.28, 11.29, 11.30, 11.63.

# D5. Defaults are syntax, not the args gate

**Refused:** letting `.default(20)` in the `args` gate participate in the key.

**Because** a gate's default is post-key normalisation, so `getInvoices()` and
`getInvoices({ limit: 20 })` would land on two keys and the commonest args pattern there is would
double-load silently.

**Decides:** 11.31, 11.32.

# D6. A global cache has no eviction policy

**Refused:** a byte ceiling, and an LRU count.

**Because** measuring an arbitrary `Stored` costs a byte walk to the leaves, where the `structural`
compare 5.4 makes the default short-circuits on reference equality and bails on the exotic types a
size would still have to price; and an LRU would evict an entry a reader is mid-flight on. The bound
is a number the app knows and abide does not.

**Assumes:** 5.4, 11.37.

**Decides:** 11.37, 11.38.

# D7. A request-scoped read inside a global body is a build error

**Refused:** stating it as advice.

**Because** advice is remembered per call site, and this is what licenses deriving the `max-age` in
`cache-control` from a global memo's `ttl` — not a promise the app made and might have broken, but a
shape the build refused to compile. The directive beside it is not licensed here and is D72's,
access being a different axis from variance.

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

# D13. Named refusals are few, and the rest stay undeclared

*Amended by D63: the count is three, `HttpError` being the third.*

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

*D29 through D33 were never written. Five clauses shipped citing them during the split and were
repointed; the numbers are burned rather than free, per format rule 5, so an old `See D30` in a
plan, a commit message or a review comment resolves to this note rather than to silence.*

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

# D41. A demo per behaviour

**Refused:** one realistic problem per page, with every section a snippet cut out of it.

**Because** that shape sizes the example by how many names the page claims, and it puts the
evidence somewhere the render is not. A page teaching six behaviours had to invent a domain
needing all six, so a reader spent attention on customers and exchange rates to reach a claim
about caching — and the claim itself lived in an authored bench row rather than in anything that
ran. A demo scoped to one behaviour shrinks the domain to whatever that behaviour needs, and what
such a demo then owes a reader is D45's.

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

**Consequence:** `Config` is declaration-merged like `Shared`, which drops the type
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
than as loss. A window collapses a batch into one delivery instead, narrowed by D68 to what retention
still holds, which is 35.10's shape with a window where the flush is — and for a scalar read the batch is the latest value, so one rule reads
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
past the ring was already app data behind an ordinary rpc, per 9.13, and that rpc is what a
returning reader joins on. What tells the reader which of the two it is looking at is the epoch,
and D100 is what makes the discard move one.

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
what stops that is the author spelling the gate — `{await}` per 32.2, or awaiting the value per
2.12 and D95. The
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

**Consequence:** an app whose global answer really is open says `public` itself, per 21.11 — the
direction where being wrong is visible on the endpoint that chose it.

**Assumes:** 11.39, 21.11.

**Decides:** 21.9, 21.10, 21.12.

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

# D77. An example may serve itself

**Refused:** a wire fixture per address the arm asks for.

**Because** a field filtering as it types asks a different address per keystroke, and a fixture is
authored against one. The prefixes a reader plausibly types toward three names are about twenty
entries, and the Requests panel is a tab per entry — so the set that makes the frame answer is the
set that makes the panel unreadable. `vanilla/server.ts` is already the hand-written half every
ratio is against, and running it makes the answer real code rather than a bigger pile of authored
ones.

**Consequence:** the panel and the network are two artifacts for an example that serves itself,
where the fixture was both, so an exchange the panel shows is no longer one the frame performed —
`served.test.ts` dispatches every wire entry through the routes instead.

**Decides:** 40.20.

# D78. A member access on a reactive name short-circuits

**Refused:** lowering `foo.bar` to `foo().bar` and leaving the optional chain to the author.

**Because** the fault is silent in exactly the case it matters and loud nowhere else. 2.2 hands back
`undefined` before a value lands, so an unguarded access throws a `TypeError` out of a body that is
correct on every run after the first — and D70 is why there is a first run at all, a body running to
completion against unlanded sources rather than aborting and retrying. The throw then fails the
producer, and 2.3 turns every later read of what it fed into a throw of its own, so one absent `?.`
converts a one-frame absence into a permanent failure. A guard the author writes is a guard the
author forgets, and 31.7 already commits to the access reaching the value rather than the
`Reactive`, so there is one lowering to put it in.

**Refused also:** typing the access as `Stored` and treating the absence as a fact only the runtime
knows. An author writing `?.` against a non-nullable type writes a chain the checker calls
redundant, and 32.25 loses the thing it narrows FROM — a block binding each read once then reads as
common-subexpression elimination rather than as the narrowing it is.

**Consequence:** the guard is uniform and unwritten, a whole chain short-circuiting with its
receiver and a block over an absent list iterating zero times. What it does not do is decide which
arm is right — the branch still takes its `else`, which is D71's subject, and a gate is still
spelled with `{await}` or by awaiting the value, per D95.

**Assumes:** 2.2, 2.3, 31.7, 32.25.

**Decides:** 31.12, 32.26.

# D79. Only a definitely-evaluated read is started early

**Refused:** hoisting every read an `{await}` operand mentions into the set 31.10 starts.

**Because** a read the expression would never have performed is a load nothing asked for. The set is
syntactic, which is what lets it be one parallel start rather than a chain, and syntax cannot tell
which arm of a conditional runs — so a hoist over `flag ? a.x : b.y` starts both and blocks the hole
on whichever is slower, having been told to fetch one. The same reaches the right operand of `&&`,
`||` and `??`, where the left operand exists precisely to decide whether the right one is evaluated,
and a body nested inside the operand, which may never be called at all.

**Consequence:** those reads lower in place and serialize, which is the correct trade for a read
that might not happen. The reads that do hoist are the ones the expression performs unconditionally,
so 41.2's single parallel start covers the common shape and the conditional shape pays for itself.

**Assumes:** 31.10, 41.2.

**Decides:** 31.13.

# D80. The mutator lift is type-directed

**Refused:** lifting a member call by NAME, on a list of the mutators a built-in carries.

**Because** a payload may carry a `push` of its own. A name-directed lift reads that call as a write
through the path, copies down it per 31.11 and hands the copy to a method that meant to mutate what
it was given — so the app's own method runs against a copy nothing else holds, and the write it
performed is discarded silently. The type is what separates the two, and it is available at exactly
the site that decides.

**Consequence:** where the type does not resolve to a built-in mutator the call falls to 31.8 and
reaches the value, which is the unlifted `O(1)` escape a stream wants — and it stays available
deliberately, 31.11's copy per write being `O(n²)` over an accumulating value.

**Assumes:** 31.8, 31.11.

**Decides:** 31.14.

# D81. abide's own inline script is hashed, not nonced

**Refused:** stamping `csp.nonce` on the inline output `render` emits.

**Because** the nonce is minted per response and the head is not. A nonce in abide's own output puts
a per-request byte inside the one region of the document that is otherwise identical for every
caller, so the shell head stops being a buffer cut once at boot and becomes a string rebuilt per
render. What abide emits inline is its own code rather than the app's, it is fixed at build time,
and a hash is the mechanism that fits a constant — 29.10 is what makes it available, and D39 is why
there is no third inline string to hash, an answer never reaching the document at all.

**Refused also:** widening the baseline to `'unsafe-inline'` and dropping the question. That
disables the hash and the nonce together for every script on the page, so an app's own inline script
loses the protection `csp.nonce` exists to give it, in exchange for abide not having to build two
constants.

**Consequence:** nothing in the head consumes a nonce, which is what lets the head be cut once at
boot. `csp.nonce` is left to the app's own inline `<script>`, which renders in the body and is
per-request anyway.

**Assumes:** 29.5, 29.10, 41.6.

**Decides:** 29.9.

# D82. A lazily reached scope is adopted, not injected

**Refused:** injecting a `<style>` element for a route's scope when navigation reaches it.

**Because** a `<style>` element is inline output and `style-src` governs it, so every lazily
navigated route would need a nonce or a hash for a stylesheet the build already content-hashed. A
constructed sheet is not an element, `style-src` does not reach it, and the scope arrives by the
same content-hashed artifact 34.5 already made it a dependency of.

**Refused also:** a fallback for engines without the mutable-array form. It is Chrome 99, Firefox
101 and Safari 16.4, so the newest engine lacking it predates anything abide targets — and a
fallback path for no live engine is a second style transport that every later change has to keep
working, tested by nothing.

**Consequence:** a branch that mounts later on a route already linked needs none of this, its scope
having been in the sheet before the branch existed. Nothing an app writes differs between the two
cases.

**Assumes:** 34.3, 34.5.

**Decides:** 34.6, 34.7.

# D83. The caller handle stays on the server

**Refused:** exposing `principal.caller` to a browser as the other members of `principal` are.

**Because** the one client-side use for a stable per-visitor id is the fingerprinting the handle
must not become. Server-side it is a key for what an app stored against this browser, and the app
already holds both ends. Handed to a browser it is a durable identifier any script on the page can
read and forward, surviving a sign-out only until 26.7 rotates it — and abide would have shipped the
identifier rather than the app having chosen to.

**Consequence:** it is not a field of `Principal`, so nothing carries it over the wire, and reading
it in a browser is a throw rather than a silent `undefined` — a value that reads as absent invites a
fallback, where a throw names the side it belongs to.

**Assumes:** 26.5, 26.7, 26.10.

**Decides:** 26.23.

# D84. A load a write supplies over a served value refreshes rather than pends

**Refused:** reporting `s.pending` for every load, on the reading that 4.2 makes a load one thing
wherever it arrives.

**Because** the two probes answer different questions, and 4.2 asks neither: it says the value is
loaded, where `s.pending` says there is nothing trustworthy to show. Over a landed value there is,
and a uniform `pending` would blank a rendered value on every reload — 3.4 opens a sink on it, so a
second write of a load would pull a filled hole back open. That is the flash 7.4 and 7.5 exist to
avoid, and it would have arrived through the write path instead of the trigger path, with no option
naming it and nothing in the design saying the two paths differ.

**Consequence:** `s.set` and `s.refresh` land on one probe over a value being served, which is what
a reader watching a spinner already assumed, and the difference between them stays where it is
observable — what `s.refresh` reloads from, and what a write supplies.

**Consequence:** the entry is what has landed, rather than the `memo` that holds it, so the two
places a value changes identity underneath a reader keep pending. A fresh `Args` key is a different
`Reactive` with nothing on it, and 11.16 and 11.19 have a re-adoption take the newly adopted
`Reactive`'s report rather than the outgoing one's. Neither is a write, and this entry decides
nothing about either.

**Assumes:** 7.9, which is the one case where a landed value is not being served: an
`s.invalidate` marked it stale, and a load over it pends.

**Decides:** 3.14.

# D85. An unrun memo is pending, not empty

**Refused:** reporting every probe false until the body has run.

**Because** false everywhere is a value that has finished with nothing, and it is indistinguishable
from one — a template reads `s.success` false, `s.pending` false, and renders the empty branch for a
computation that has not started. The report was an artefact rather than a position: a propagated
probe derived from the source list (11.22) has no sources to walk before the first run, and reading
zero of them as "nothing in flight" answers about a walk instead of about the value.

**Consequence:** 3.2 still holds — the probe reports the work owed rather than starting it, so a
`memo` nothing has read is pending until something reads it, and the first read is what runs the
body. The keyed form is in it for the same reason and not a case beside it: 11.4 computes an entry
on the first read of that key, a probe is not a read, and a key nothing has read yet is therefore
the same unrun body under a different name. What 11.25 withholds from a keyed `memo` is
propagation, which is a report about the values a body read rather than about the body.

**Assumes:** 11.5, 11.21, 11.22.

**Decides:** 11.61.

# D86. A probe over an uncomputed key allocates nothing

**Refused:** one get-or-create serving both paths, so that a probe reaches an entry the way a read
does.

**Because** the shared lookup is the simpler implementation and it is the one 13.2 cannot survive.
Only a read runs a body, per 11.4, and 11.61 has an unrun body report pending — so a slot a probe
created is pending with nothing left that can move it, and a `Selection` over the `memo` answers
true forever after one probe of a key nobody reads. The rest of the cost lands where nothing is
looking: 11.38 refuses size and count eviction on a `global` `memo`, so the slot stays for its
`ttl`, and 11.55's single timer is armed at the oldest entry, which is the one that will never
produce.

**Consequence:** the probe path reads the map and the read path is what writes it, which is the
split 9.16 already made for a room — a subscribe allocates nothing and reads as pending, and a
publish is what brings the room into existence. A key is a question until something reads it, on
both mechanisms, and the face `m` hands back for an uncomputed key is a way to ask rather than the
entry itself.

**Assumes:** 11.4, 11.38, 11.55, 11.61, 13.2.

**Decides:** 11.62.

# D87. Structural for a value, the reference for a message

**Refused:** one default `identity` across every producer.

**Because** the two disagree about what a repeat is. A state and a memo RE-MATERIALISE: a reload
that fetched an equal payload built a fresh object for a value that did not change, and comparing
by reference there never fires — every reader wakes on every reload, which is the silent failure
the invariant is written against. A publish is the opposite. Two identical messages are two events
somebody sent on purpose, and structural comparison delivers one: the second collapses under 5.2
and 9.8 hands the publisher back the standing sequence number, so a chat sending `ok` twice reports
a delivery that did not happen. Comparing by reference collapses a literal republish of one object,
which is a re-send rather than a second message.

**Consequence:** the divergence belongs to the producer and not to the option — `identity` is one
name with one meaning wherever it is declared, and a room that wants de-duplication declares it as
anywhere else would. What the split costs is that which default is in force is decided by which
factory was called, and a reader carries that.

**Assumes:** 5.2, 9.8.

**Decides:** 5.4, 5.5.

# D88. A per-request value is a memo, not a record of its own

**Refused:** `bag`, an untyped record carried for the life of one request with its own
declaration-merged interface for the keys.

**Because** it was the third thing D52 found already had every part of a `memo` and the one that
escaped the finding. 11.34 makes an unkeyed `memo` request-local on a server without an option
saying so, 11.40 coalesces two reads in one scope into one load, and the body's return type is the
declaration — where `Bag` was a second artifact an app edited to teach the record what it already
held. The record also carried none of the surface the value has anyway: a rung resolving a user
had nowhere to put the load, so `pending`, `error` and `invalidate` were absent from the one
per-request value most likely to want all three.

**Consequence:** where a rung awaited the value so every handler could read it synchronously, the
await stays in the rung and fills the memo rather than the record — a memo is what a rung writes
to under 11.7, and 26.15 already has `principal` in exactly this shape. What changes for a handler
that did not want the rung is that the await becomes visible at the read, which is 2.1 and 2.2
being true of this value the way they are of every other.

**Assumes:** 11.7, 11.40.

**Decides:** 11.34.

# D89. The response is an ambient, not a helper per framing

**Refused:** a body helper that CONSTRUCTS a `Response` — `json`, `jsonl` and `sse` as they were,
each taking a `ResponseInit` so a handler could set a header.

**Because** the helper bundled the header with the framing, and only the header was the handler's
to decide. 16.32 and 16.34 already derive the framing from what the handler returned and what the
caller asked for, so reaching for `sse` to set one header hard-coded the negotiation — and 16.36
holds the seed transcript in the chunk type's own framing whichever framing went out, which a
hard-coded one has no answer for. The escape hatch was worse than the helpers: a bare `Response` costs the MCP and CLI
surfaces outright under 16.40, so the price of one header was two of the four surfaces.

`cookies` is the same mechanism over one header and was already in the design, request-scoped and
collecting its writes onto the response under 22.3 — so the general form is the one name that was
missing rather than a new idea.

**Consequence:** `json` goes and does not come back, a settled value having nothing to be early
about — 16.32 frames it the moment the handler returns. What D92 restores is `jsonl` and `sse`, with
`bytes` beside them, as writes through `response` rather than as constructors, which is the half of
them this entry was never against.

**Consequence:** a status does not compose the way a header does. A handler read in process during
a render is answering into the page's response, where a cookie it sets belongs and a 201 does not,
so a status written through `response` joins the wire-only list in 16.14 and is inert in process.
That is the inert-variant shape rather than an exception: one name everywhere, doing nothing on the
call that has no wire.

**Assumes:** 16.32, 16.34, 16.36, 16.40, 22.3.

**Decides:** 21.11, 22.11.

# D90. A refusal is returned, and the throw is the exception

**Refused:** `refuse` throwing while every declared refusal is returned.

**Because** the two disciplines shared a prefix and nothing but the documentation kept them apart.
15.6 has a declared refusal refuse by being returned and 15.11 makes a discarded one a compile
error, so the gate that catches the mistake was already written over the returning form and could
not see the throwing one. Returning also puts the undeclared refusal inside the check: `refuse(404)`
written as a statement is now the compile error 15.11 states, where a throw made the same line
correct and the reader could not tell which they had written.

**Refused also:** the reverse — one verb that throws, taking a declared refusal, as
`refuse(overdrawn({ amount }))`. A thrown value carries no type, so `Failures` could no longer be
computed the way 1.4, 15.2 and 16.9 compute it. Inferring it from the call sites reaches direct
calls and not a handler that refuses through a helper, which reports a union NARROWER than the
truth — and a caller's `rpc.isError` exhaustiveness is then wrong in the direction nothing catches.
D71 refused a syntactic check on the same ground.

**Consequence:** the throw survives where there is no return channel, and 18.4 is the one place —
a `SocketEvent` rung answers `void`, so a socket refuses with `throw refuse(403)` and 15.11 does
not reach a throw statement. The other cost is a helper refusing three frames deep inside a handler
body, which returns up rather than unwinding; 16.17 already has a rung short-circuit by returning,
so the onion needed nothing.

**Assumes:** 15.6, 15.11, 16.17, 18.4.

**Decides:** 17.8.

# D91. The framing is a table the chunk type indexes, not a clause per framing

**Refused:** naming each framing in its own clause — jsonl as the default, and sse as the one
`Accept` value that overrides it.

**Because** the second framing was written as an exception to the first, so a third could only
arrive as a second exception. `Accept` is already a negotiation the protocol defines over a set,
and abide was answering it with one hard-coded comparison — which also restated 21.8, the `vary`
that every header-dependent answer carries anyway. As a table indexed by the chunk type, adding a
framing is a row, and the default falls out of the order rather than needing a clause to say which
one it is.

**Refused also:** letting `Accept` choose across chunk types. A stream of bytes asked for as jsonl
would frame each chunk as an array of numbers, which is the shape a caller least wants and the one
16.34 produced before the chunk type bounded the set. What a caller negotiates is the framing among
those its chunks admit, and a byte stream admits one.

**Consequence:** the seed buffer's unit follows the chunk type rather than being jsonl by name, so a
byte stream's transcript is bytes and 41.8 answers a re-executed read of one without a transcoding
step in the middle. A `Blob` returned whole keeps 16.38's range support and a stream does not, which
is the trade between the two spellings rather than a gap in either.

**Assumes:** 16.37, 16.48, 16.49, 21.8, 41.8.

**Decides:** 16.34, 16.36, 16.50.

# D92. A helper exists where the derivation would otherwise be late

**Refused:** deriving every framing from the first chunk, with no way for a handler to name one.

**Because** response headers precede the body, so a framing read off the first chunk holds every
header until that chunk exists — and the streams most worth streaming are the ones whose first
chunk is slowest. A token stream waiting on a model, or a report whose first row is a cold query,
would send nothing at all until it arrived, so time to first byte became time to first chunk. It is
worse than a latency figure for one framing: a browser's `EventSource` reports an open connection
off the headers, so a reader could not learn the stream had been established.

Only the CHUNK TYPE was ever late. `Accept` arrives with the request, so the negotiation 16.34 makes
could always have run at once, and 16.51 is what is left of the wait — value against binary, read
off the first chunk rather than off a type, which is what keeps a server free of a compile step.

**Refused also:** a fourth name declaring the chunk type without fixing the framing, which would
keep the negotiation alive for a handler that only wanted its headers out. It is the more precise
tool and it is a fourth concept for a cost nobody has measured yet; the three that fix are a
superset in effect, and the narrower one can arrive later without moving any of them.

**Consequence:** a handler reaching for `sse` to flush its headers has also declined to serve jsonl
to a caller that asked for it, per 17.11. That coupling is the price of three names rather than
four, and it is visible at the call site, which is where a reader can undo it.

**Assumes:** 16.34, 16.50, 16.51.

**Decides:** 17.10, 17.11.

# D93. A room's envelope is the room's, not the socket's

**Refused:** framing a room over http as bare messages, the sequence number and the epoch being
things the socket lane carried.

**Because** 18.16 makes the sequence number the DEFAULT KEY of a `{#for await}` block over a `Room`,
and 41.9 has a block the server already painted reconciled against the replayed productions BY THAT
KEY rather than appended to. So a room declared as a `GET` over a `Channel` had a key its own wire
did not carry, and hydration could only append — which is the duplicate paint 41.9 exists to refuse.
It was not a missing feature but a clause that could not run on one of the two transports its
producer is reachable through.

The epoch travels for the same reason one level up: 18.14 delivers the ring marked as a reset and
18.15 has a block clear and repaint, and a client that cannot see the epoch move cannot tell a reset
from a gap.

**Refused also:** building abide's own client on `EventSource`, which would have brought reconnect,
backoff and the resume free. It takes a url and `withCredentials` and nothing else, so it cannot set
a request header — and 24.6 has `trace.headers` carry `traceparent` on an outbound request, with
21.2's `traceresponse` correlating the answer against it. A room read that way is a hole in the
trace, and every argument for it was an argument for machinery the constraint puts out of reach.

**Consequence:** the client reads a room over `fetch` on both lanes and reconnects itself, so 18.13
is one mechanism rather than two spellings of one, and jsonl's byte of framing per chunk is what a
room costs rather than sse's eight. sse keeps `id:` and `event: reset` under 16.53 and 16.54, which
is a courtesy to a hand-written `EventSource` outside our client rather than the path we take.

**Assumes:** 18.10, 18.11, 18.13, 18.14, 18.16, 24.6, 41.9.

**Decides:** 16.52, 16.53, 16.54.

# D94. The seed is the render's own production, not a second call

**Refused:** filling the seed buffer by issuing the call again once the render has finished with it.

**Because** 16.12 runs a rung on every call, so the second one runs the authorization, the rate limit
and the logging a second time to record an answer that already existed. 11.40 does not cover it:
coalescing is over the LOAD, and an entry already cached in the scope is still reached through the
rungs — and a mutation carries `ttl` 0 under 16.7, so there is no entry to reach.

The refill also records something the page never showed. A value that moved between the render and
the refill leaves a document and a seed that disagree, and the disagreement surfaces at the client
as the hydration mismatch 41.13 names — against a page that was correct when it was written.

**Consequence:** the buffer can hold only what the render read, which is what makes 41.13 legible:
a miss means the client took a path the server did not, rather than meaning the buffer was filled
from somewhere else and came up short. D39's account of what is saved — the handler's work, not the
round trip — is now a requirement rather than an assumption it was resting on.

**Assumes:** 11.40, 16.7, 16.12, 41.13.

**Decides:** 41.14.

# D95. A `Reactive` is thenable, and `s.settled` goes

**Refused:** the ban 1.2 carried — a `Reactive` with no promise face at all, and every gate spelled
`s.settled`.

**Because** the ban was paying for a discrimination rather than for a semantics. Thenability was
reserved across the design as the mark of a load — 4.1 and 4.2 for a write, 8.4 for a store's
synchronous `get`, 11.11 for a `memo`, 31.5 for an assignment — and nothing ever had to state the
reservation while one type was exempt from it. What the exemption bought was a value with no
`await`, and the server is where that costs: 16.4 has an `Rpc` callable in both arms, and the
in-process arm is an async function whose natural spelling for a read is the one the ban removed.

**Refused also:** `then` alone, with `catch` and `finally` withheld. Three members over one settling
is a single concept; the member plus two exceptions is two, and the exception is the half a reader
has to be taught. Withholding `finally` also reads as a claim about 3.9 — a room whose `s.done`
never turns true — and 1.6 makes no such claim, what ends being the settling rather than the value.

**Refused also:** keeping `s.settled` beside the promise face. Once `s.then` answers, the method is
a second spelling of one concept and every call it could serve is a call `await` serves — the
replaced path that CLAUDE.md has leaving in the same change. Dropping it is also what makes 2.12
and 2.13 land on one member, `catch` and `finally` following from it by 1.6 rather than three
delegations standing side by side. It is a public name, so the removal is the discussion that rule
asks for rather than an assumption inside it.

**Consequence:** the reservation stops being a coincidence and becomes 1.7, and the collision it
settles is 11.11 against 11.12. Adjacent clauses, disjoint only while 1.2 held, and both now answer
to a `memo` body returning a `Reactive`. Resolved the other way the returned value is awaited to one
settled `Stored` and kept, which is what D43 refused and diagnosed in advance: 11.13's mirroring
goes, and 11.19's forwarded `pending` reads false for the whole of the load it wraps. 14.7 makes
`memo(() => call(args))` the compulsory spelling, so the wrong branch would be the common one rather
than an edge.

16.43 needs no exception. An async handler returning a `Reactive` types as its `Stored` once the
value is thenable, so the return type no longer carries one and the check never fires there; the
same value nested in a returned object is untouched by `await`, still carries it, and stays the
compile error D60 is about. The split falls out of the type rather than being written.

The price is one branch order in a per-interaction path — the load test reads for the brand before
it reads for `then` — and D71's and D78's gate is now `{await}` in a template and `await` on the
value everywhere else, the third spelling those entries named having gone with the method.

What the removal does not buy back is a cached promise. `s.then` observes the settling in flight
when it is called, so a re-await re-reads and an assimilated `Promise.resolve` freezes one
settling — which is what `s.settled` did too, and is a fact about the value rather than about
either spelling.

**Assumes:** 2.3, 3.9, 4.1, 4.2, 8.4, 11.11, 11.12, 11.13, 11.19, 14.7, 16.4, 16.43, 31.5.

**Decides:** 1.5, 1.6, 1.7, 2.12, 2.13.

# D96. An option is uniform, and stands inert where it does nothing

**Refused:** withholding an option from the one producer it cannot mean anything on, and typing the
withholding.

**Because** the withheld option is two concepts where the uniform one is a single concept: the
option, and the exception to it. 18.17 was the worked case — `clients` on a `socket` omitted the
`openapi` key, and paying for the omission meant `Clients` became two types, one per producer, so
every reader of either had to know which it had. An option that exists everywhere and does nothing
on one producer is understood from the invariant it already carries; the same option withheld there
has to be taught, is a branch in the implementation, and is a case in every debugging session after
that. 20.2 replaces it: the key is there, it defaults on, and a `socket` generating no OpenAPI
operation is the answer rather than a rule about it.

**Refused also:** treating this as a preference to be weighed per option. It was already written
down in `CLAUDE.md` as a working bias and reached for as authority by two plans and by D89's
inert-status argument, with no entry to cite — which is a product decision living in the working
notes, where the four documents are the product's and `CLAUDE.md` answers how to work here.

**Consequence:** an inert variant is a shape a reader meets more than once, so the cost of the
uniformity is a name that reads as available and does nothing. That is paid at the call site, where
it is visible, rather than in the type, where the withholding was.

**Assumes:** 20.1, 20.3.

**Decides:** 20.2.

# D97. `s.streaming` gets its own clause, and 3.6 is narrowed rather than mirrored

**Refused:** resolving the 3.6/3.14 collision by making a streaming producer pend only until its
first chunk, the way 3.7 has a room pend only until its first message.

**Because** the two producers are not the same shape and the symmetry is a trap. A room's value IS
the latest message, so the first message is something to show and `s.pending` has done its job. A
streaming producer's value is the ACCUMULATION, which is not complete until close — and 2.12
resolves `s.then` at the moment `s.pending` becomes false, so a stream pending only to its first
chunk makes `await` hand back one chunk where every other clause about a stream's value expects the
whole of it: 8.9 has a store write once at close on the accumulation, and 8.6 seeds the ring with
it on restore. The mirror would have been a silent change to what awaiting a stream returns.

**Refused also:** leaving `s.streaming` with no clause of its own. It had none — its REGISTRY row
cited 3.1, 3.2 and 3.3, which is every probe — so the only clause saying anything about a stream
being in flight was 3.6, on `s.pending`. That is why the collision was on `pending` at all: the
answer was being carried by the wrong probe for want of one on the right probe, and 8.7 already
read `s.streaming` false on a restored stream with nothing to be consistent with.

**Consequence:** the collision at `s.set` is a NARROWING rather than a contradiction. 3.14 is the
more specific clause — a load given to `s.set` over a landed value that is not stale — and a stream
is a load, so D84's reason applies to it unchanged: there is something trustworthy on screen and
blanking it is the flash. 3.6 keeps governing the case it was written for, where nothing has landed,
which is also the case 2.12 needs it for.

**Assumes:** 2.12, 3.7, 3.14, 8.6, 8.7, 8.9.

**Decides:** 3.6, 3.15.

# D98. A public file is addressed by its name, never by its hash

**Refused:** content-hashing a file under `src/ui/public` and answering it the way 21.6 answers a
chunk.

**Because** the fixed address is the entire reason the directory exists. A browser asks for
`/favicon.ico` and a crawler for `/robots.txt` — names nobody gets to choose — and a hashed name is
a name the build chose. The year 21.6 grants is safe only where a change to the bytes is a change to
the address; at a fixed address the same year is a deploy nobody sees, held in every cache that
believed it, with no way to reach in and correct it.

**Refused also:** an option letting an app lengthen the life of one file. It buys the year back for
whoever is certain, and certainty about a file at a fixed address is the thing that turns out to be
wrong on the deploy after next — a favicon is the canonical case of a file that changes once, years
later, and has to change everywhere at once.

**Consequence:** a warm browser spends a conditional request per public file per page load, and the
common answer is a 304 rather than a hit taken without asking. That is the price of the fixed
address, and it is paid on files that are few and small; anything neither of those belongs in the
bundle, where 21.6 applies and the hash is what makes it safe.

**Assumes:** 21.6.

**Decides:** 21.13, 21.14, 21.15, 36.13.

# D99. A directory the build knows, not a route the app writes

**Refused:** leaving every static file to 37.2's route, which is where a `robots.txt` was answered
before this.

**Because** it puts the file on the wrong side of dispatch. 37.2 runs inside the app lane, ahead of
everything, so each path it compares is compared on every request that will never match one — and
what it produces is a `Response` assembled in a `fetch` handler rather than an entry in the static
table `Bun.serve` answers before a handler runs. The version each app writes is also the same six
lines every time, and those six lines have no `etag`, no `content-type` off the extension and no
304, because none of the three is what the author was thinking about.

**Refused also:** rooting the directory at the origin rather than at the mount, on the reading that
a crawler asks for `/robots.txt` at the origin and nowhere else. An app under `/docs` does not own
that origin's root — whatever put it there does — and an app answering for it would be answering on
behalf of a site it is one part of. 37.2 is still the escape hatch where an app genuinely owns the
origin, and it still runs first.

**Consequence:** a file joins and leaves the served surface by being added to or removed from a
directory, which is the shape 23.3 already gives a page and 19.1 a handler.

**Assumes:** 37.2, 23.3.

**Decides:** 36.12, 36.14, 36.15, 38.19, 38.20.

# D100. A room's epoch identifies the instance, not the process

**Refused:** making 9.17's discard a second cause of epoch movement, beside the process restart
9.21 named.

**Because** the epoch would then have to SURVIVE the discard to be moved past, and the only way to
survive it is a table of last-seen epochs keyed by room — which is the permanent process-wide entry
per key that D64 discarded rooms to be rid of. The repair would have reinstated the thing the rule
it repairs exists to remove. Resuming 18.10's sequence number across the discard fails the same way
and for the same reason.

Minting at construction costs no retention at all: a discarded room's epoch goes with it, and the
next construction mints one that cannot collide. 18.13 only ever compares epochs, never orders
them, so the value needs no arithmetic and no continuity — which is what 18.11 now says outright.

**Refused also:** leaving the collision as it stood. 9.17 discards a room at zero subscribers and
9.21 held the epoch still inside one process, so a discard-and-republish rewound 18.10's sequence
number under an unmoved epoch. 18.16 makes that number the default key of a `{#for await}` block and
41.9 reconciles a painted block against it BY THAT KEY, so the rewound keys collide with rows the
server already painted — and D93 names the reading a client is left with, unable to tell a reset
from a gap. Nothing contradicted anything: 9.21 was true, 18.11 was true, and the case fell between
them.

**Consequence:** the process restart stops being a rule and becomes an instance of one, a restart
constructing new rooms and so minting new epochs. 18.11 loses its "only cause" clause rather than
gaining a second cause, which is D96's shape — the epoch moves exactly when a room is constructed,
with no case to teach. 18.13 becomes correct for the discard for the first time: a returning reader
finds a different epoch, 18.14 delivers the ring marked as a reset, and 18.15 repaints from it.

**Assumes:** 9.17, 18.10, 18.13, 18.14, 18.16, 41.9.

**Decides:** 9.21, 18.11.

# D98. The request path answers with nothing bound

**Refused:** reaching the request path only through a listener.

**Because** a test that has to bind a socket to ask a question needs a port, and the suite runs its
files in worker processes: two files holding an app then contend for one, and a port something else
on the machine already took fails a test about routing. `App.listen` supplies the socket and
nothing else, and dispatch never reads it. The tests that genuinely want `server` or a real
`WebSocket` ask for `port: 0`, and two concurrent servers were measured taking distinct ephemeral
ports.

**Assumes:** 42.9.

**Decides:** 42.3, 42.5.

# D99. A test holds the app, not a client of its own

**Refused:** a test client generated off the app, beside the app object.

**Because** an `Rpc` is already the same callable on both sides and a rung already runs on the
in-process call, so what a test lacks is a scope and an entry into the request path rather than a
caller. A generated one would be a second spelling of the things that cannot differ — the address,
the rungs, the coercion — and the only caller in the app that nothing in production exercises, which
is the drift a wire-shaped test exists to catch. What a test reaches for a client *for* is the steps
a wire adds, and `App.fetch` runs those steps rather than standing in for them.

**Assumes:** 16.4, 16.12, 16.14.

**Decides:** 42.6, 42.13.

# D100. Boot is the app, not the port

**Refused:** `onStart` wrapping the listener.

**Because** boot is the app becoming able to answer, and a bound socket is the host's business:
`abide dev` keeps the listener on the main thread and replaces the worker under it, so a hook tied
to the bind would run on a schedule belonging to the reload rather than to the app, and would report
a port the host owns and the app never chose. `createApp` is where the tables, the onions and
`config` land, and it is what a test and a host both hold.

**Consequence:** a hook cannot observe the port, and a hook that wants one takes it from the host.

**Assumes:** 38.15, 38.16, 42.5.

**Decides:** 37.4, 42.4.
