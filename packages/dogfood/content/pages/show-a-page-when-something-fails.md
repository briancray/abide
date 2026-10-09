---
title: Show a page when something fails
nav: Error pages
intent: Where a failure lands, what it renders in, and why 404 is not a special case.
covers:
  - `src/ui/pages/**/error.abide`
  - `onError`
  - `allow: GET, HEAD`
examples:
  - packages/dogfood/examples/error-report.json
---

An `error.abide` is the page a failure renders in. It is resolved **nearest-ancestor**, exactly
as a layout is, so a section can answer for its own failures and the app answers for the rest.

```abide #ui/pages/error.abide — excerpt
<script>
import { notFound, props } from 'abide'

const { failure } = props<{ failure: Failed }>()
</script>

{#if notFound.is(failure)}
    <h1>No such page</h1>
    <p>Nothing answers {failure.data.method} {failure.data.path}.</p>
{:else}
    <h1>Something went wrong</h1>
    <p>{failure.message}</p>
{/if}
```

The failure arrives as a **bare value**, not as a `Reactive`, so there is no `s.isError` to hang
a narrowing off. Every refusal factory carries its own `is` for exactly this, and it carries the
type with it — so an error page narrows by name without a registry and without a cast.

Read on: [Failures](../server/refuse-a-request-and-say-why.md)

## 404 is a refusal like any other

There is no separate not-found page and no special-casing of a status. An address nothing
answers is `notFound`, which is a refusal built with `refuse.named` like the ones your app
declares, carrying `{ path, method }` so the page can say which address.

That is why the error page's shape is a narrowing rather than a status switch: the page asks
which failure this is, and "no route matched" is one of the answers rather than a different
mechanism arriving at the same file.

A page asked by any method but `GET` or `HEAD` is the same shape: a refusal at 405, painted by the
same error page, carrying `allow: GET, HEAD` for whoever sent the `POST`.

## An error page that fails escalates past the boundary

An `error.abide` that itself throws does not recurse and does not render half of itself. It
**escalates past** its own boundary — the next ancestor answers — and warns on `abide:render`
so the failure is not swallowed by the machinery meant to report failures.

That is the one case where a quiet fallback would be the wrong kindness: an error page that
silently renders nothing is an app that looks fine and shows nobody anything.

## `onError` is the app's hook, not the page's

{% example error-report %}

`onError` runs on an unexpected error in that scope. It is where reporting goes — a log line, a
call to whatever watches the app — and it is not where rendering goes: the page is markup, and
the hook is a function. A throw that is not a refusal answers the caller with a bare 500 and
nothing about itself, so the reason reaches the hook and never the browser.

Read on: [Lifecycle](../app/run-code-at-start-and-stop.md) ·
[Logging](../app/record-what-happened.md)

## Next

* [Failures](../server/refuse-a-request-and-say-why.md) — declaring the refusals this narrows
* [Layouts](give-pages-the-same-chrome.md) — resolved the same nearest-ancestor way
* [Conditionals](../templates/show-markup-conditionally.md) — `{#try}`, the boundary inside a page
