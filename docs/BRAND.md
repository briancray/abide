# What abide is

An isomorphic, type-safe framework for async interfaces — for humans and for machines —
built on Bun and web standards.

**The problem.** Most of a web app is plumbing between two computers. A value lives on the
server; you want it on screen. So an author writes a route, a handler, a fetch, a loading
flag, an error branch, a cache key, and a type kept in sync by hand. Six artifacts, none of
them the product, all of them theirs to maintain.

**The wedge.** Declare what a value *is*; reading it is what loads it. There is one container
type, one spelling for a read, and one place a failure surfaces.

**The second audience.** The declaration that serves a page already carries an address, a
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
| **One container type.** | `State` is the only container face. `state`, `memo`, `channel`, `rpc` and `socket` all hand one back, so `pending()`, `await`, `for await` and the probes mean the same thing on every one of them. |
| **Same name, both sides.** | `route.url`, `cookies()`, `log.info` and the rest resolve on either side. Nothing is a shim that no-ops on one of them; where a name genuinely cannot mean anything it throws and names the component and the accessor. |
| **Reading is what loads it.** | A `memo` runs its body on first read and re-runs when what the body read changes. There is no effect, no mount hook, no `load()`. |
| **It does not block.** | A read of a value still in flight returns `undefined` and opens a sink; the document goes out and the hole fills. Holding is opt-in and spelled `{await x}`. |
| **A refusal is a value.** | `Failed<Name, Data>` carries data and narrows by name with `isError`, in-process and over a wire, for a template and for a model alike. |

# What we do not say

The measurement discipline in `CLAUDE.md` is a brand asset, not an internal rule. It is what
lets the claims above be short. Breaking it once makes every other claim a guess.

| Do not say | Until |
| --- | --- |
| Fast, faster, zero-cost, no overhead | There is a RATIO against hand-written code in the same substrate. Absolute milliseconds from a DOM emulator describe the emulator |
| A bundle-size number | The build exists and the number is measured, not estimated |
| Production-ready, battle-tested, stable | Something is in production |
| A comparison to a named framework | The comparison has been run on the same input, in the same engine, with the work counted — not just the wall clock |
| "Just works" / "magic" | Never. The whole pitch is that a reader can see WHY it works; magic is the opposite claim |

**Today the honest frame is a DESIGN, not a product.** The workspace, the seams, the
measurement lanes and the documentation are real; the framework is not written. Say so. The
docs already do, and being early in public is only a liability if the copy pretends otherwise.

# Vocabulary

The words are the product. A reader who learns one of these should not meet a synonym for it
three pages later.

| We say | Not | Because |
| --- | --- | --- |
| container | store, atom, signal, observable | There is one, it is `State`, and the other words each carry a different library's semantics |
| declaration | hook | `hook` is taken: `onStart`, `onStop`, `onConfig` are abide's lifecycle hooks |
| room | topic, subscription, channel instance | A room is what `channel` and `socket` both hand back, and it is a `State` with `publish` |
| refusal, failure | error | An error is what went wrong; a refusal is a declared answer with a name and data |
| probe | flag, status boolean | `pending()`, `refreshing()`, `done()` — a probe never throws and never starts work |
| sink | placeholder, suspense boundary | An addressable slot a value in flight fills later |
| seam | layer, boundary | `#ui`, `#server`, `#shared` — an import edge the build enforces |
| by name | auto-tracking, magic reactivity | Reading `count` in a template IS `count()`; the sugar is over the explicit form, never instead of it |

**abide is lowercase**, in prose and in the wordmark, including at the start of a sentence.

# Voice

* **Claim, then evidence, in the same breath.** "No API layer *because there is nothing for
  one to do*" beats "no API layer!"
* **Second person, present tense.** What *you* write, what *it* does.
* **Name the cost.** Every real trade gets said out loud — the seams are all-or-nothing, a
  `GET` that writes is reachable cross-origin, `config()` throws in a browser. Naming costs is
  what makes the claims believable.
* **No exclamation marks. No "simply", "just", "easy", "blazing".**
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
