---
title: Keyed memoization (normative specification)
nav: Caching, normative spec
intent: The caching guide as a conformance document — numbered clauses, RFC 2119 keywords, no motivation.
examples:
  - packages/dogfood/examples/caching
---

> **Style — normative specification.** RFC 2119 / W3C shape. Numbered clauses, capitalised
> requirement keywords, and a conformance section. Written so that two independent implementations
> agree, which means it states what MUST hold and never why anyone would want it. Examples are
> marked non-normative and carry no requirements.

The key words **MUST**, **MUST NOT**, **SHALL**, **SHOULD**, **SHOULD NOT** and **MAY** in this
document are to be interpreted as described in RFC 2119.

## 1. Scope

This document specifies keyed memoization: the derivation of a cache key from arguments, the
lifetime and extent of a cache, the process-wide variant, and invalidation by tag.

It does not specify the unkeyed, tracked memo except where clause 3 distinguishes the two, nor the
transport that exposes a memo, except where clause 7 constrains the response it produces.

## 2. Terminology

**Memo** — a `Reactive` whose value is produced by a body.

**Keyed memo** — a memo whose body declares a parameter.

**Args** — the value of that parameter, of type `Record<string, JsonValue>`.

**Key** — the canonical serialization of an `Args` value.

**Entry** — one held value, addressed by one key.

**Scope** — the extent within which a cache exists: one request on a server, one session in a
browser.

## 3. Form

3.1 A body declaring no parameter **MUST** produce an unkeyed memo, and that memo **MUST** be
tracked: a change to a reactive value the body read **MUST** cause re-evaluation.

3.2 A body declaring one parameter **MUST** produce a keyed memo, and that memo **MUST NOT** be
tracked. A change to a reactive value its body read **MUST NOT** cause re-evaluation.

3.3 A keyed memo **MUST** be a callable accepting `Args` and returning a `Reactive`. Probes and
triggers **MUST** be exposed on the returned `Reactive` and **MUST NOT** be exposed on the memo.

3.4 An implementation **MUST NOT** provide an option converting one form into the other. The
presence of the parameter is the sole discriminant.

## 4. Key derivation

4.1 A key **MUST** be derived from `Args` by canonical serialization, and that serialization
**MUST** be the one the transport applies to the same arguments.

4.2 Members **MUST** be ordered by name. Argument order **MUST NOT** affect the key.

4.3 A member whose value is `undefined` **MUST** be omitted. An explicitly `undefined` member and
an omitted member **MUST** address the same entry.

4.4 A `Date` **MUST** be serialized in ISO 8601 form.

4.5 Key equality **MUST** be structural. Two distinct `Args` objects of equal canonical
serialization **MUST** address the same entry.

4.6 An `Args` value that cannot be serialized **MUST** be rejected, and it **MUST** be rejected at
the same point as an argument that cannot be sent.

## 5. Cache extent and lifetime

5.1 A cache **MUST** belong to a scope. On a server that scope **MUST** be one request; in a
browser it **MUST** be the session.

5.2 A cache **MUST** be created with its scope and destroyed with it.

5.3 An entry created in one scope **MUST NOT** be readable from another.

5.4 `ttl: Infinity` **MUST** mean the lifetime of the scope, and **MUST NOT** mean an unbounded
lifetime.

5.5 Two reads of one key within one scope **MUST** share a single evaluation of the body. Reads in
distinct scopes **MUST NOT** share one.

## 6. Global memoization

6.1 `global: true` **MUST** place entries in a cache whose lifetime is the process, independent of
any request scope.

6.2 A global cache **MUST** be readable by every caller. It is the only mechanism by which two
callers share one evaluation of a body.

6.3 An implementation **MUST** reject, at build time, a global body that reads a request-scoped
ambient. `request()`, `principal`, `cookies()`, `csp.nonce()` and `route` **MUST** each be
rejected, and the diagnostic **MUST** name the ambient rejected.

6.4 A global cache **MUST** be bounded by `ttl` and by explicit invalidation, and **MUST NOT** be
bounded by any other mechanism. An implementation **MUST NOT** evict on a size or count limit.

6.5 A global memo over a streaming body **SHOULD** be declared with `tail: Infinity`. Where it is
not, a reader subscribing after the first chunk **MUST** receive the production in flight from
its start and then its remaining chunks, and this **MUST NOT** be reported as an error.

## 7. Derived response metadata

7.1 A `GET` transport over a non-global memo **MUST** answer `private, no-store`.

7.2 A `GET` transport over a global memo **MUST** answer `max-age` derived from the memo's `ttl`,
expressed in seconds. An implementation **MUST NOT** require the duration to be stated a second
time.

7.3 A `GET` transport over a global memo **MUST** answer `private`. An implementation **MUST NOT**
derive `public` from `global`.

## 8. Invalidation by tag

8.1 `tags` **MUST** accept an array of strings, or a function receiving the memo's `Args` and
returning one.

8.2 An entry **MUST** carry the tags its memo declared at the time the entry was created.

8.3 `invalidate` selecting on a tag **MUST** match every entry carrying that tag, across memos and
across modules, and the caller **MUST NOT** be required to name those memos.

8.4 A tag **MUST** be scoped as clause 5 scopes a cache. An invalidation in one scope **MUST NOT**
affect another scope's entries.

## 9. Conformance

An implementation conforms to this document if it satisfies every **MUST** and **MUST NOT** in
clauses 3 through 8. Clause 10 is non-normative and contains no requirements.

## 10. Non-normative example

The following is provided for illustration only.

{% snippet caching src/server/rpc/customers.ts const customerById %}

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

{% example caching %}

## 11. References

* [Reactive](../reference/reactive.md) — the interface clause 3.3 refers to
* [Caching](../values/load-once-per-set-of-arguments.md) — a non-normative treatment of this material
* [Reloading](../values/decide-when-a-value-reloads.md) — the selections clause 8 refers to
