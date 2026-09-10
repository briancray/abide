---
title: Link to another page
nav: Links & navigation
intent: Build a URL that survives a rename and a mount path, and go there.
covers:
  - `url`
  - `Query`
  - `ParamsOf<P>`
  - `HasParams<P>`
  - `HasSegments<P>`
  - `RequiredNames<P>`
  - `OptionalNames<P>`
  - `RestNames<P>`
  - `navigate`
  - `route.url`
  - `route.navigating`
---

`url` builds an address from a **route literal** — the pattern, not the address. So the thing
you write down is the thing the router already knows, and a route that moves takes its links
with it.

```abide #ui/pages/invoices/page.abide — excerpt
<a href={url('/invoices/[id]', { id: invoice.id })}>{invoice.reference}</a>
```

## The literal decides the arguments

| The literal carries | `url` takes |
| --- | --- |
| a required segment | a params argument, required |
| only optional or rest segments | a params argument, optional |
| no segments at all | no params argument |

That is one rule read off the pattern rather than a signature you keep in step with it. A
required segment maps to a required key, an optional one to an optional key — and leaving an
optional key out **omits the segment**, rather than producing an address with a hole in it. A
rest segment takes an array as well as a scalar.

The `Query` argument is **last**, always. There is one place a query string can go, so no call
site has to decide.

## The types are the pattern, read by the compiler

| | |
| --- | --- |
| `ParamsOf<P>` | the params object a literal `P` requires |
| `HasSegments<P>` | whether `P` has any dynamic segment at all |
| `HasParams<P>` | whether `P` requires a params argument |
| `RequiredNames<P>` | the `[name]` segments |
| `OptionalNames<P>` | the `[[name]]` segments |
| `RestNames<P>` | the `[...name]` segments |

None of these is something an app writes. They are how the signature above is derived from a
string literal, and they are documented because a compile error mentions them — an error naming
`RequiredNames` is telling you which segment you left out.

Read on: [Routes](add-a-page.md)

## `navigate` goes there without reloading

```ts browser
navigate(url('/invoices/[id]', { id: '4310' }))
```

It navigates and **does not reload the document**, so the layouts stay, the values already
loaded stay loaded, and the head's keyed contributions are replaced rather than rebuilt. An
ordinary `<a href>` does the same thing — `navigate` is for the case where the decision is made
in code rather than by a click.

Read on: [Layouts](give-pages-the-same-chrome.md) ·
[View transitions](animate-from-one-page-to-the-next.md)

## `route.url` and `route.navigating`

`route.url` is where you are. `route.navigating` is whether a navigation is in flight, which is
what a progress bar reads and what a link disables itself on.

Both are ambient reads like any other, so a layout showing a loading bar needs nothing passed
to it and no router object in scope.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md)

## Every address resolves against the mount

`url` produces a **mount-relative** address, resolved at read time. That is what lets the same
build serve at the root and under `/docs` — and it is the reason to reach for `url` rather than
write the string, even for an address that will obviously never move.

Read on: [Sub-path mounting](serve-the-app-under-a-sub-path.md)

## Next

* [Routes](add-a-page.md) — the literals these are built from
* [Handler URLs](../server/find-the-url-a-handler-answers-on.md) — the same job for a handler
* [View transitions](animate-from-one-page-to-the-next.md) — what a navigation can look like
