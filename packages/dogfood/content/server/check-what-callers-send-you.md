---
title: Check what callers send you
nav: Schemas
intent: Reject a malformed body at the boundary, with a type on the other side that matches.
covers:
  - state › `schema`
  - memo › `schema`
  - memo › `args`
  - channel › `args`
  - `Schema<T>`
  - `JsonValue`
  - `Issues<T>`
  - `Paths<T>`
  - `validateJson`
  - `JsonSchema`
  - channel › `schema`
examples:
  - packages/dogfood/examples/schema-browser
  - packages/dogfood/examples/schema-issues
  - packages/dogfood/examples/schema-key
---

A handler's arguments are a shape written down twice in most stacks: once as a TypeScript type
the compiler checks, once as a validator the runtime checks. Two spellings of one fact, and the
drift between them is silent.

Here the annotation you already wrote **is** the schema. `GET(({ id }: { id: number }) => …)`
builds the runtime schema for `{ id: number }`, and a caller sending `{ id: "abc" }` gets a 422
before the handler runs. Where that derivation is not enough, one option pins the shape, at the
producer rather than at the address.

## A derived schema reads `required` off the syntax

One rule, readable from the declaration alone: `required` is which destructured members lack
defaults, and `Args` itself is optional where the parameter has one.

| Declaration | Schema | Called as |
| --- | --- | --- |
| `({ id }: { id: number })` | `{ id: number }`, `id` required | `getInvoice({ id: 42 })` |
| `({ id = 1 })` | `{ id?: number }`, `default: 1` | `getInvoice()` or `getInvoice({ id: 7 })` |
| `({ id = 1 } = {})` | `Args` itself optional | `getInvoice()` with a bare URL |
| no parameter at all | none | `getInvoice()` |

## `schema` is the input, `transform` is the output

Deriving from an annotation means the build resolves types, so build time is typecheck time —
and a schema is only ever as good as the inference that reached it. Where inference **fails**
the compiler reads on rather than refusing the file, because valid TypeScript has to compile.
The cost is that an unresolved annotation degrades to a **wider** schema, silently.

That is the trade "the shape is never declared twice" is bought with, and the repair is two
options at two **positions**. `schema` gates what comes in:

```ts #server/rpc/invoices.ts — excerpt
import { z } from 'zod'

const invoices = memo(
    (args: { lines: Line[] }) => database.invoice.create(args.lines),
    { schema: z.object({ lines: z.array(lineSchema).min(1) }) },
)

export const createInvoice = POST(invoices)
```

`transform` shapes what gets stored:

```ts #shared/ledger.ts — excerpt
const paidIds = memo(() => listInvoices({ year }), {
    transform: (all) => new Set(all.filter((r) => r.paid).map((r) => r.id)),
})
```

They are not two spellings of one job. `Accepted` and `Stored` already name the two ends, and
that second one has no validation in it at all. So the **option name** is the discriminant: a
function in `schema` refuses by throwing, a function in `transform` refuses by returning a
`Failed`, and neither has to be told from the other.

**"Input" means what the producer consumes**, which is one rule read three ways. A state
and a channel consume a value, so `schema` checks that value. A memo consumes **args** — its body
takes them — so `schema` on a memo is the argument shape, re-declared over `Args` in
`MemoOptions`. An unkeyed memo, consuming nothing, cannot spell it at all: a compile error naming
the overload, not an option that quietly does nothing.

With no `transform`, `Stored` is `Accepted` and `schema` decides both ends. Nothing declares
that; it falls out of the types.

Either option pins a shape you will not have widened, and either is where a constraint the type
system cannot express goes — a non-empty array, an ISO date, a bounded number.

## A schema runs where its value lives

Not "on the server" — **where the `Reactive` is declared**. One in `#ui` checks in the browser,
one in `#server` checks on the server, one in `#shared` checks wherever it was used. That is the
seams doing their job rather than a rule of validation's own.

{% example schema-browser %}

*1 option, 0 validators* — the arm spells the shape a second time, in a form nothing compares
against the annotation it came from.

A refused write fills `error()` rather than throwing, and stores nothing — so the field keeps
what was typed while the record keeps what it had. On a primitive the issues are a bare
`string[]`, there being no path to key them under.

An rpc's handler is a memo in `#server`, so a browser calling it through the generated wrapper
cannot pre-check — the wrapper carries a method, an address and a description, and nothing else.
Not an exception; that is where the memo is. Want the same shape checked on both sides and you put
it in `#shared` and declare it twice — the one duplication this design asks for, and it asks for
it deliberately.

## There is no `schemas` on `GET` or `POST`

A shape is a fact about the **value**, the way `ttl` and `tail` are, so it rides in on the `memo`
that was passed and `RpcOptions` is left describing an address — `description`, `middleware`,
`timeout`, `crossOrigin`, `maxBodySize`.

So `GET(getInvoice)` and `POST(getInvoice)` state the shape once between them, and an in-process
caller gets the check a wire caller gets. A schema declared at the transport
is one that **skips itself** every other way the handler is reached — composed inside another
memo, imported by a second server module — so the shape would hold for your untrusted callers
and not for your own code.

`GET(fn)` is still sugar for `GET(memo(fn))`. Write the memo out when you have a schema to
declare, and not otherwise.

## `Schema<T>` takes three forms

```ts shared
type Schema<T> = ((value: unknown) => T) | StandardSchemaV1<T> | JsonSchema
```

A schema **returns what it accepts**, so it normalises as well as refuses. That is why the
function form is `=> T` and not a predicate: a `boolean` cannot normalise, and a `false` stored
as the value is the silent version of a refusal.

| Form | What it is |
| --- | --- |
| `(value: unknown) => T` | returns what it accepts, throws a sentence at what it refuses |
| `StandardSchemaV1<T>` | the interop spec zod, valibot and arktype all answer to |
| `JsonSchema` | a JSON Schema document — the **native** form |

A handler means `JsonSchema`, and it is the only form publishable to a tool definition or an
OpenAPI operation. `validateJson(schema, value)` is the native validator, handing back `null`
when the value matches and `Issues<T>` when it does not.

## `Issues<T>` is keyed by path, not a list

```ts shared
type Issues<T> = T extends object
    ? Partial<Record<Paths<T> | '', string[]>>
    : string[]
```

A record on a composite, a bare list on a primitive — because the reader always has the path in
hand.

{% example schema-issues %}

A flat list would cost a `find` **per field per render** — twenty scans on a twenty-field form.
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
key**. A value that cannot be serialized cannot be keyed, and a memo that cannot key its
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

## A schema normalises the value; it does not decide the key

{% example schema-key %}

A memo's entry is filed under the arguments **as sent**, and the schema runs after. So a
normalisation in it changes what the body sees and never which entry it is.

The order is forced rather than chosen. A browser has to compute the same key the server does in
order to find its seeded value, and it cannot run a schema it was never sent. So the key is
taken before validation. Otherwise every handler with a normalising schema re-issues its call on
hydration.

On a `channel` the same cost is sharper: two spellings of a room key are **two rooms**, and a
publisher in one is invisible to a subscriber in the other with nothing warning either. Where
arguments must collapse, normalise them at the caller or type them so the variation cannot be
spelled. The schema is the wrong instrument.

## A channel is the one producer with both

A room's message is its input, so that is `schema` — the same option a state uses, `Accepted`
being `Message` here:

```ts #shared/rooms.ts — excerpt
export const thread = channel({ schema: messageSchema })
```

It runs on **every** publish, the app's own included, because validity is not a question about who
is asking. So the `socket` declares who may connect and whether a frame may
publish at all, and nothing about what a frame contains.

But a channel also has a **room key**, and that is where it parts company with a memo. A memo's
args *are* its input — the body consumes them — so a memo spells that `schema`. A room's
key merely picks which room while the message flows, so it keeps a separate `args`:

```ts #shared/rooms.ts — excerpt
export const thread = channel<Post, { id: string }>({
    args: z.object({ id: z.string().uuid() }),
    schema: messageSchema,
})
```

Two positions, so two options, and this is the only producer with both. Both are derived from
the type when not provided, the same way a handler's are, and a room key is checked but never
normalised: two spellings of one key are two rooms.

Read on: [Sockets](keep-a-room-of-callers-in-sync.md)

## Next

* [Authorization](decide-who-may-call-what.md) — why a 401 rung runs before any parse
* [Limits](put-a-ceiling-on-a-request.md) — the ceiling on a body, checked before buffering
* [OpenAPI](../machines/describe-your-api-without-writing-a-spec.md) — where the schema is published
