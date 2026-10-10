---
title: Check what callers send you
nav: Schemas
intent: Reject a malformed body at the boundary, with a type on the other side that matches.
covers:
  - reactive › `schema`
  - `args`
  - `Schema<T>`
  - `JsonValue`
  - `Issues<T>`
  - `Paths<T>`
  - `validateJson`
  - `JsonSchema`
  - `jsonSchema`
examples:
  - packages/dogfood/examples/schema-browser.json
  - packages/dogfood/examples/json-schema.json
  - packages/dogfood/examples/schema-issues.json
  - packages/dogfood/examples/validate-json.json
  - packages/dogfood/examples/schema-key.json
---

A handler's arguments are a shape written down twice in most stacks: once as a TypeScript type
the compiler checks, once as a validator the runtime checks. Two spellings of one fact, and the
drift between them is silent.

Here the annotation you already wrote **is** the schema. `GET(({ id }: { id: number }) => …)`
builds the runtime schema for `{ id: number }`, and a caller sending `{ id: "abc" }` gets a 422
before the handler runs. Where that derivation is not enough, an option pins the shape, on the
value rather than at the address.

## A derived schema reads `required` off the syntax

One rule, readable from the declaration alone: `required` is which destructured members lack
defaults, and `Args` itself is optional where the parameter has one.

| Declaration | Schema | Called as |
| --- | --- | --- |
| `({ page }: { page: number })` | `{ page: number }`, `page` required | `listPayments({ page: 2 })` |
| `({ page = 1 })` | `{ page?: number }`, `default: 1` | `listPayments()` or `listPayments({ page: 7 })` |
| `({ page = 1 } = {})` | `Args` itself optional | `listPayments()` with a bare URL |
| no parameter at all | none | `listPayments()` |

## `args` and `schema` gate what comes in, `transform` shapes what is stored

Deriving from an annotation means the build resolves types, so build time is typecheck time —
and a schema is only ever as good as the inference that reached it. Where inference **fails**
the compiler reads on rather than refusing the file, because valid TypeScript has to compile.
The cost is that an unresolved annotation degrades to a **wider** schema, silently.

That is the trade "the shape is never declared twice" is bought with, and the repair is an
option at each **position**. `args` gates the arguments a keyed value is called with:

```ts #server/rpc/invoices.ts — excerpt
import { z } from 'zod'

const invoices = reactive(
    (args: { lines: Line[] }) => database.invoice.create(args.lines),
    { args: z.object({ lines: z.array(lineSchema).min(1) }) },
)

export const createInvoice = POST(invoices)
```

`transform` shapes what gets stored:

```ts #shared/ledger.ts — excerpt
const paidIds = reactive(() => listInvoices({ year }), {
    transform: (all) => new Set(all.filter((r) => r.paid).map((r) => r.id)),
})
```

They are not two spellings of one job. `Accepted` and `Stored` already name the two ends, and
that second one has no validation in it at all. So the **option name** is the discriminant: a
function in `schema` or `args` refuses by throwing, a function in `transform` refuses by returning
a `Failed`, and neither has to be told from the other.

**Each gate checks one position.** `schema` checks the value: what a `set` writes, what a body
produced, and what a stream has accumulated (4.3, 11.46, 9.8). A `patch` mutates the value in place
and runs no `schema` (5.7), so a write that has to be checked is a `set`. `args` checks the arguments a keyed value is
called with (11.40), and it only refuses (11.28). A value whose body takes no parameter has no
arguments, so it cannot spell `args` at all (11.41), rather than carrying an option that quietly
does nothing.

With no `transform`, `Stored` is `Accepted` and `schema` decides both ends. Nothing declares
that; it falls out of the types.

Either option pins a shape you will not have widened, and either is where a constraint the type
system cannot express goes — a non-empty array, an ISO date, a bounded number.

## A schema runs where its value lives

{% example schema-browser %}

*1 option, 0 validators* — the arm spells the shape a second time, in a form nothing compares
against the annotation it came from.

Not "on the server" — **where the `Reactive` is declared**. One in `#ui` checks in the browser,
one in `#server` checks on the server, one in `#shared` checks wherever it was used. That is the
seams doing their job rather than a rule of validation's own.

A refused write fills `error()` rather than throwing, and stores nothing — so the field keeps
what was typed while the record keeps what it had. On a primitive the issues are a bare
`string[]`, there being no path to key them under.

An rpc's handler is a `reactive` in `#server`, so a browser calling it through the generated
wrapper cannot pre-check — the wrapper carries a method, an address and a description, and nothing
else. Not an exception; that is where the value is. Want the same shape checked on both sides and you put
it in `#shared` and declare it twice — the one duplication this design asks for, and it asks for
it deliberately.

## There is no `schemas` on `GET` or `POST`

A shape is a fact about the **value**, the way `ttl` is, so it builds the value rather than
the address. Hand `GET` a plain function and `args` sits beside `description` in one object, because
`GET(fn, options)` **is** `GET(reactive(fn, options))` — the `args` gate builds the value, and
`description`, `middleware`, `timeout`, `crossOrigin` and `maxBodySize` describe the address.

So one `reactive` handed to both `GET` and `POST` states the shape once between them, and an in-process
caller gets the check a wire caller gets. A schema declared at the transport
is one that **skips itself** every other way the handler is reached — read inside another
value, imported by a second server module — so the shape would hold for your untrusted callers
and not for your own code.

Write the `reactive` out when something besides the handler holds the value — a second handler,
a page reading it in process — and pass `GET` the options otherwise.

## `Schema<T>` takes two forms

```ts shared
type Schema<T> = ((value: unknown) => T) | StandardSchemaV1<T>
```

A schema **returns what it accepts**, so it normalises as well as refuses. That is why the
function form is `=> T` and not a predicate: a `boolean` cannot normalise, and a `false` stored
as the value is the silent version of a refusal.

| Form | What it is |
| --- | --- |
| `(value: unknown) => T` | returns what it accepts, throws a sentence at what it refuses |
| `StandardSchemaV1<T>` | the interop spec zod, valibot and arktype all answer to |

A JSON Schema document is the **native** shape, and it enters as the Standard form.

## A JSON Schema document gates a value through `jsonSchema`

{% example json-schema %}

`jsonSchema(document)` wraps a document as a Standard Schema that carries its own validator, so it
goes wherever a `Schema` goes. The refusal is worded by the document, and keyed the way `Issues<T>`
keys any other schema's.

A handler means `JsonSchema`, and it is the only shape publishable to a tool definition or an
OpenAPI operation — the wrapper exposes the document where a Standard Schema exposes its JSON
Schema, so it is published as written.

A document is data, so something has to read it, and `jsonSchema` is what brings the validator.
A page that never calls it carries none of it (19.13). Hand a gate a bare document and it refuses
with the sentence naming the wrapper (19.14), rather than accepting a shape it never checked.

## `Issues<T>` is keyed by path, not a list

{% example schema-issues %}

```ts shared
type Issues<T> = T extends object
    ? Partial<Record<Paths<T> | '', string[]>>
    : string[]
```

A record on a composite, a bare list on a primitive — because the reader always has the path in
hand. A flat list would cost a `find` **per field per render** — twenty scans on a twenty-field form.
It is `string[]` and not `string` because one field fails two ways at once, too short *and*
malformed, and one message per path is a loss with nothing naming it.

`Paths<T>` is the dot-joined leaf paths — `lines.0.qty`, never `lines[0].qty`. One spelling, and
it is the one every Standard Schema already hands back: `['lines', 0, 'qty']` joined, so there
is no bracket grammar to specify and nothing to parse back.

| Where | Key |
| --- | --- |
| a field | `'lines.0.qty'` |
| the whole value — a `refine`, a thrown sentence | `''` |
| a primitive | no key; `data` is the `string[]` |

Two costs worth knowing. `Paths<T>` is **depth-limited**, because a recursive template-literal
type is typecheck time paid on every handler; past the limit the key widens to `string` and the
lookup stops being checked. And integer-like keys iterate first in JavaScript whatever the
insertion order — what an array wants, and what a mixed shape merely has.

Read on: [OpenAPI](../machines/describe-your-api-without-writing-a-spec.md)

## `validateJson` checks a value nothing gates

{% example validate-json %}

`validateJson(schema, value)` is the validator `jsonSchema` carries, called on its own. It hands
back `null` when the value matches and `Issues<T>` when it does not, and stores and refuses
nothing either way. Reach for it where the value is not one you hold yet — a pasted row, an import,
a file — and the only question is whether it fits.

A keyword it does not implement throws rather than being skipped, because a document declaring a
constraint nothing applied reads as checked. `format` is one. `title`, `description` and `default`
are annotations, and pass.

## `JsonValue` is the bound on an argument

```ts shared
type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [k: string]: JsonValue }
```

The bound exists because the canonical wire form of an arguments object is also its **cache
key**. A value that cannot be serialized cannot be keyed, and a keyed value that cannot key its
arguments cannot coalesce two callers onto one load.

`GET` and `DELETE` narrow it further, their wire form being URL parameters: flat only, an array
being the repeated key `URLSearchParams` already has a form for. A nested object is keyable and
is not sendable, so it is refused at compile time naming the method — and the error says the
fix is a `POST`, and that a `POST` gives up the browser cache.

Read on: [Mutations](change-something-on-the-server.md)

## Coercion happens before validation, not inside the schema

A `GET`'s arguments arrive as text. They are coerced from the JSON Schema's declared `type`
first — `"number"` through `Number()`, `"boolean"` from `"true"` / `"false"`, `"array"` from
the repeated key — and validated after:

| Declared | `?limit=20` becomes |
| --- | --- |
| `number` | `20` |
| `boolean` | `true` / `false` |
| `array` | every repeat of the key, in order |

That table is total over the flat argument types, and it is the same one `style: form, explode:
true` publishes. It runs at the first `ctx.args()` that asks, so every rung after that and the
handler see the coerced value.

`validateJson` stays a checker. Putting coercion in the schema instead would ask every form of
`Schema` to coerce, which the native validator does not do and a Standard Schema does its own
way.

## A schema refusal is 422 and carries the issues

A schema refusal is `422` carrying `Failed<'ValidationError', Issues<Args>>`. A malformed body —
not valid JSON at all — is `400`. Both are raised where the first middleware rung asks for the
arguments.

`isError` narrows `.data` to `Issues<Args>`, so the key is checked against your own argument
shape rather than being an untyped string index — a typo in `'lines.0.qty'` is a compile error.

Read on: [Failures](refuse-a-request-and-say-why.md)

## `args` refuses; it does not decide the key

{% example schema-key %}

A keyed value's entry is filed under the arguments **as sent**, and `args` runs after (11.26). A
normalisation in it reaches the body (11.68) but never changes which entry it is (11.28).

The order is forced rather than chosen. A browser has to compute the same key the server does in
order to find its seeded value, and it cannot run a gate it was never sent. So the key is
taken before validation. Otherwise every handler with a normalising gate re-issues its call on
hydration.

In channels keyed by their args the same cost is sharper: two spellings of a channel key are
**two channels**, and a message patched into one is invisible to a subscriber of the other with
nothing warning either. Where arguments must collapse, normalise them at the caller or type them so the
variation cannot be spelled. The gate is the wrong instrument.

## A channel gates the array with `schema` and the key with `args`

A channel is an array, so its `schema` checks the whole array on every `set` — the app's own
included, because validity is not a question about who is asking:

```ts #shared/channels.ts — excerpt
export const announcements = reactive<Post[]>([], {
    schema: z.array(messageSchema),
    global: true,
})
```

What it does not see is a `patch`. An append through `patch` mutates the array in place rather than
minting a production (5.7), so neither `schema` nor `transform` runs on it. A message that has to be
checked arrives one of two ways: as a `set` of the whole array, where `schema` or a `transform`
reads its last element, or checked by the code that patches it in. A caller outside the process is
always the second kind. Its only way in is a `POST` whose handler patches the channel, so that
handler's `args` and its body are the check.

A channel keyed by its args also has a **channel key**, and that is the parameter its body
declares, so it is `args`. The key picks which channel while the messages flow:

```ts #shared/channels.ts — excerpt
export const thread = reactive((_args: { id: string }): Post[] => [], {
    args: z.object({ id: z.string().min(1) }),
    schema: z.array(messageSchema),
    global: true,
})
```

Two positions, so two options. Both are derived from the type when not provided, the same way a
handler's are, and a channel key is checked but never normalised (11.28): two spellings of one key
are two channels.

Read on: [Live updates](keep-a-room-of-callers-in-sync.md) ·
[Channels](../values/let-anything-publish-and-anything-read.md)

## Next

* [Authorization](decide-who-may-call-what.md) — why a 401 rung runs before any parse
* [Limits](put-a-ceiling-on-a-request.md) — the ceiling on a body, checked before buffering
* [OpenAPI](../machines/describe-your-api-without-writing-a-spec.md) — where the schema is published
