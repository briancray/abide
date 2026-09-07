---
title: Owned reactive values (normative specification)
nav: Normative spec
intent: The local-state guide as a conformance document — numbered clauses, RFC 2119 keywords, no motivation.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — normative specification.** RFC 2119 / W3C shape. Numbered clauses, capitalised
> requirement keywords, and a conformance section. Written so that two independent implementations
> agree, which means it states what MUST hold and never why anyone would want it. Examples are
> marked non-normative and carry no requirements.

The key words **MUST**, **MUST NOT**, **SHALL**, **SHOULD**, **SHOULD NOT** and **MAY** in this
document are to be interpreted as described in RFC 2119.

## 1. Scope

This document specifies the construction, reading, writing and transformation of an *owned
reactive value*, hereafter a **state**, as produced by the `state` factory.

It does not specify derivation (`memo`), publication (`channel`), persistence (`store`), or the
compilation of `.abide` source to JavaScript, except where clause 4 constrains the observable
behaviour of that compilation.

## 2. Terminology

**State** — a `Reactive` whose value is supplied by the application rather than computed by a body.

**Accepted** — the type of a value supplied to the factory or to `set`, before validation and
transformation, and after settlement.

**Stored** — the type of the value held by the state, and the type returned by a read.

**Production** — a materialisation of a `Stored` value that readers observe.

**Producer** — a source from which a state can obtain a value without an application write.

## 3. Construction

3.1 `state` **MUST** accept zero, one or two arguments: an optional initial value, and an optional
options object.

3.2 Where an initial value is supplied and is settled, the state **MUST** hold that value, subject
to clause 5.

3.3 Where an initial value is supplied and is unsettled, the state **MUST** be *loaded*: it
**MUST** report `pending()` as `true` until settlement, and on settlement it **MUST** hold the
settled value. It **MUST NOT** hold the unsettled value itself.

3.4 Where no initial value is supplied, the state **MUST** be a `Reactive<undefined>` and **MUST**
report `success()` as `true` from construction. Such a state **MUST NOT** report `pending()` as
`true` at any time before a write.

3.5 The value returned by `state` **MUST** be a `Reactive`, indistinguishable in interface from one
returned by any other factory in this design.

## 4. Reading and writing

4.1 A state **MUST** expose exactly two members for value access: a call signature returning
`Stored`, and `set`, accepting `Accepted` or a promise of `Accepted`.

4.2 A read performed during the evaluation of a reactive expression **MUST** register that
expression as a reader of the state.

4.3 A production **MUST** cause every registered reader to be re-evaluated. A write that does not
result in a production **MUST NOT** cause any reader to be re-evaluated.

4.4 Within a `.abide` source, an identifier bound to a state **MUST** be compiled as follows:

* in an expression position, as a read;
* in an assignment position, as a write of the assigned value;
* in a `bind:` directive, as both;
* in any other position, as the `Reactive` itself.

4.5 The explicit forms of clause 4.1 **MUST** remain valid within a `.abide` source and **MUST**
have the same meaning there as in any other source. An implementation **MUST NOT** treat clause 4.4
as a replacement for clause 4.1.

## 5. Validation and transformation

5.1 Where a `schema` is supplied, it **MUST** be applied to the settled value before any
transformation, and its return value **MUST** be what the transformation receives.

5.2 A refusal by `schema` **MUST** be surfaced as `Failed<'ValidationError', Issues<Accepted>>`. An
implementation **MUST** catch a throw from `schema` and convert it; the throw **MUST NOT** escape
`set`.

5.3 Where a `transform` is supplied, it **MUST** be applied to the settled value, untracked, once
per production, and **MUST NOT** be applied to an unsettled value.

5.4 A `transform` **MAY** refuse a value by returning a `Failed`. Where it does, the write **MUST**
be rejected and no production **MUST** occur.

5.5 Where no `transform` is supplied, `Stored` **MUST** be `Accepted`. A `schema` alone **MUST NOT**
cause `Stored` and `Accepted` to differ.

5.6 A refusal by either gate **MUST** be observable through `error()` and **MUST NOT** be
observable as a rejection reaching an `{:catch}` clause.

## 6. Producers and triggers

6.1 A state constructed per clause 3.3, or supplied with a `store`, **MUST** be considered to have
a producer.

6.2 A state with a producer **MUST** respond to `refresh()` and `invalidate()`, and `ttl` **MUST**
apply to the value it holds.

6.3 A state without a producer **MUST** treat `refresh()`, `invalidate()` and `ttl` as inert. An
implementation **MUST NOT** discard the held value of a state without a producer.

## 7. Conformance

An implementation conforms to this document if it satisfies every **MUST** and **MUST NOT** in
clauses 3 through 6. Clause 8 is non-normative and contains no requirements.

## 8. Non-normative example

The following is provided for illustration only.

{% snippet local-state src/shared/profile.ts export const handle %}

{% snippet local-state src/shared/profile.ts export const profile %}

{% snippet local-state src/ui/pages/profile/page.abide <h1> … <input bind:value %}

{% example local-state %}

## 9. References

* [Reactive](../reference/reactive.md) — the interface clause 3.5 refers to
* [Local state](../values/show-a-value-that-changes.md) — a non-normative treatment of this material
