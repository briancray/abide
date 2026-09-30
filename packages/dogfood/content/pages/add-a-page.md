---
title: Add a page
nav: Routes
intent: A file becomes a route, and the parts of the path become values you can read.
covers:
  - `src/ui/pages/**/page.abide`
  - `[name]`
  - `[[name]]`
  - `[...name]`
  - `route.params`
  - `Params`
  - `RouteParams<P>`
  - `route.name`
---

A route is a file. Put a `page.abide` under `src/ui/pages` and the path it sits at is the path
it answers on — there is no table to register it in, and nothing to keep in step with the
filesystem.

## The three dynamic segments

| The directory is named | It matches | In `route.params` |
| --- | --- | --- |
| `[id]` | exactly one segment, required | a required key |
| `[[tab]]` | one segment or none | an optional key, absent when it did not match |
| `[...rest]` | the remaining segments, terminal | a list, empty when it matched nothing |

A rest segment is terminal because there is nothing a segment after it could match against.
The other two compose freely, so `invoices/[id]/[[tab]]` is one route answering two addresses
rather than two routes agreeing about an invoice.

An optional segment that did not match is **absent** rather than empty. That is the difference
between `const { tab = 'summary' } = route.params` working and a default that never fires,
which is a distinction an empty string would quietly lose.

## What the file path decides

| | |
| --- | --- |
| `src/ui/pages/page.abide` | `/` |
| `src/ui/pages/invoices/page.abide` | `/invoices` |
| `src/ui/pages/invoices/[id]/page.abide` | `/invoices/4310` |
| `src/ui/pages/docs/[...path]/page.abide` | `/docs/start/install` |

`route.url` comes from the file path and `route.name` is the **resolution path** — the pattern
that matched, not the address that arrived. So a log line, a metric and an `{#if}` over the
current route all key on `invoices/[id]` for every invoice rather than on one address each.

```abide #ui/pages/invoices/[id]/page.abide
<script>
import { reactive, route } from 'abide'
import { getInvoice } from '#server/rpc/invoices'

const invoice = reactive(() => getInvoice({ id: route.params.id }))
</script>

<h1>Invoice {route.params.id}</h1>
<p>{invoice.error() ? 'Could not load it.' : invoice.total}</p>
```

Reading `route.params` is a live read like any other, so a navigation from one invoice to
another moves the value rather than rebuilding the page.

Read on: [Links & navigation](link-to-another-page.md) ·
[Reading data](../server/read-data-without-writing-an-api.md)

## `Params` is what the segments matched

`Params` carries what `[param]`, `[[optional]]` and `[...rest]` matched: text, or a list for a
rest. In a page it is typed from the page's own route rather than declared beside it — `abide
check` reads `route.params()` in `invoices/[id]/page.abide` as `RouteParams<'/invoices/[id]'>`, so
`id` is text and a key the route does not have is an error (23.9). A layout gets its own segments,
and whatever a page below it adds.

Nothing else is in it. A query string is not a param — it is not part of what resolved the
route, and treating it as one is how a route starts depending on something that never selected
it.

Read on: [Links & navigation](link-to-another-page.md)

## Next

* [Layouts](give-pages-the-same-chrome.md) — the chrome a page renders inside
* [Links & navigation](link-to-another-page.md) — building an address for one of these
* [Error pages](show-a-page-when-something-fails.md) — what renders when a page cannot
