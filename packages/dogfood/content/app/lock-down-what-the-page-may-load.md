---
title: Lock down what the page may load
nav: CSP
intent: A content security policy with a per-request nonce, without breaking your own scripts.
covers:
  - `csp`
  - `csp.nonce`
---

A content security policy is worth having and painful to write, because the hard part is not
the policy — it is knowing what your own build emits. `csp()` already knows: it is registered
where every rung is, and the policy it produces covers the bundle's own chunks and the styles a
component adopted.

```ts #server/app.ts — excerpt
import { csp, middleware } from 'abide'

middleware(csp())
```

## Adding a source, not writing a policy

```ts #server/app.ts — excerpt
middleware(csp({ 'img-src': ["'self'", 'https://cdn.example'] }))
```

What you pass is **merged over** what the build knows, per directive. So naming `img-src`
because your avatars live on a CDN does not require you to also know what `script-src` should
say for a bundle you did not hand-write.

That is the shape worth insisting on: a policy an app maintains by hand goes stale the first
time the build changes, and it goes stale silently — the symptom is a blocked script in a
browser nobody was testing in.

## `csp.nonce` is this response's nonce

```abide #ui/pages/layout.abide — excerpt
<head>
    <script nonce={csp.nonce()}>{raw(bootstrapSnippet)}</script>
</head>
```

A nonce is per response, which is what makes it a nonce. `csp.nonce()` hands back the one this
response is carrying, so an inline script the app genuinely wants is allowed without
`'unsafe-inline'` — and `'unsafe-inline'` is the directive that turns a policy into a comment.

Reading it is the only way to get it. There is no configuration that stamps a nonce onto
markup, because a nonce on markup the app did not write is a nonce on markup nobody vouched
for.

Read on: [Head & metadata](../pages/set-the-title-and-social-preview.md)

## `nosniff` is separate, and unconditional

`x-content-type-options: nosniff` is on **every** abide response, unconditionally, and is not
something `csp()` turns on. Every response declares its own content type, so a browser guessing
a different one is only ever the vulnerability — a JSON refusal sniffed as HTML is script
running on your origin.

Read on: [Response types](../server/answer-with-something-other-than-json.md)

## `csp()` is a rung, and composes with the others

`csp()` hands back a `Middleware`, so it sits in `middleware(...)` alongside whatever else runs
per request, in registration order. It belongs on the **app** lane rather than a handler's:
pre-routing is where a response header that is about the document goes.

Read on: [Authorization](../server/decide-who-may-call-what.md) ·
[Lifecycle](run-code-at-start-and-stop.md)

## Next

* [Lifecycle](run-code-at-start-and-stop.md) — where the rung is registered
* [Authorization](../server/decide-who-may-call-what.md) — the lane it runs on
* [Helpers](../reference/helpers.md) — `csp` beside `log`, `url` and `navigate`
