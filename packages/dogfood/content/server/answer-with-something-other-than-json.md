---
title: Answer with something other than JSON
nav: Response types
intent: A document, a redirect, a file — and the caching headers each one gets.
covers:
  - `page`
  - `json`
  - `redirect`
  - `RedirectStatus`
  - `x-content-type-options: nosniff`
  - `cache-control: no-store`
  - `cache-control: private, no-store`
  - `cache-control: public, max-age=31536000, immutable`
---

Most handlers return a value and never think about a `Response`. Some have to: a sign-in that
sets a cookie and sends the browser somewhere, an export that is a CSV, a preview that is a
whole document.

Return a `Response` instead of a value. The helpers build one, each taking a `ResponseInit`
your own headers ride in.

```ts #server/rpc/session.ts
import { POST, cookies, redirect } from 'abide'

export const signIn = POST(
    async ({ email, password }: { email: string; password: string }) => {
        const user = await users.authenticate(email, password)
        if (!user) return refuse(401)
        cookies().set('abide-principal', await seal(user), {
            httpOnly: true,
        })
        return redirect('/dashboard', 303)
    },
)
```

*1 file, 0 response middleware* — the cookie and the navigation are the same return.

## The return type already decides a content type

Before reaching for a helper, know what a plain return does:

| The handler returned | The caller gets |
| --- | --- |
| any JSON value | `application/json` |
| `undefined` | `204`, no body |
| `Uint8Array`, `ArrayBuffer`, `Blob`, `DataView` | `application/octet-stream`, or a `Blob`'s own `type` |
| an `AsyncGenerator` | jsonl, one value per line |

A binary decodes back to a `Uint8Array` on the caller's side, so an rpc that hands back a
generated PDF needs no helper and no encoding step.

Read on: [Reading data](read-data-without-writing-an-api.md) · [Streaming data](send-data-as-it-arrives.md)

## `json` adds a status or a header to JSON

```ts server
return json(rows, {
    status: 206,
    headers: { 'cache-control': 'public, max-age=60' },
})
```

The same serialization a bare return gets, with somewhere to put the rest of the response.
`undefined` sends `null`, not the text `undefined`.

## `page` sends what a render produced

`page` takes what a render **produced** rather than doing the render, which is why it takes the
generator `render` yields:

```ts #server/rpc/previews.ts — excerpt
import { page, render } from 'abide'
import Invoice from '#ui/components/Invoice.abide'

export const previewInvoice = GET(async ({ id }: { id: string }) =>
    page(render(Invoice({ invoice: await database.invoice.find(id) }))),
)
```

`text/html`, streamed as the render yields it. `render` takes an optional shell, which is what
makes an email body or an embed possible from the same component.

Read on: [Manual rendering](../pages/render-a-document-yourself.md)

## `redirect` navigates, and carries an `init`

```ts shared
type RedirectStatus = 301 | 302 | 303 | 307 | 308
```

The status is restricted to those five, defaulting to `302`, so a typo is a compile error rather
than a browser quietly ignoring the header. The `init` is where a sign-in's cookie goes, as
above.

`303` is the one a mutation wants: it turns a `POST` into a `GET` at the destination, which is
what stops a refresh re-submitting. A `POST` that returns a plain value to a form navigation
already gets a `303` back to the `Referer` without you writing one.

Read on: [Mutations](change-something-on-the-server.md) ·
[Links & navigation](../pages/link-to-another-page.md)

## `nosniff` is on every response, unconditionally

`x-content-type-options: nosniff` is on **everything**, unconditionally. Every abide response
declares its own content type, so a browser guessing a different one is only ever the
vulnerability — a JSON refusal sniffed as HTML is script running on your origin.

It is spelled a second time on the asset route, which is served in front of the pipeline and
never reaches the funnel.

## A `cache-control` default is the handler's to override

`cache-control` on a page, an rpc answer or a refusal is a **default**, not a rule — every
helper takes a `ResponseInit`, so a handler that knows its answer is shareable overrides it:

| Default | On | Why |
| --- | --- | --- |
| `private, no-store` | a page, an rpc answer, any refusal | a page renders per request and a handler answers as whoever called it. Absent is not neutral: it licenses a shared cache to invent a lifetime for an answer that names who asked |
| `max-age=<the `ttl`>` | a `GET` over a [`global`](../values/load-once-per-set-of-arguments.md) memo | one number, not two — `public` where the handler is reachable unauthenticated, `private` behind a rung, and nothing at all for `ttl: Infinity`, which no cache can be told |
| `no-store` | `/__abide/health`, `/__abide/principal` | both describe this process or this caller at this moment. A cached health check is a load balancer being told a drained instance is fine |
| `public, max-age=31536000, immutable` | the built bundle | a chunk is addressed by its own content hash, so it cannot go stale |

What the method decides is the **ceiling** on that override. A `GET` answer can be made
shareable; a `POST` answer cannot be, whatever it sets.

Read on: [Health](../app/tell-a-load-balancer-you-are-healthy.md) ·
[Build & start](../ship/build-and-serve-the-app.md)

## An app route answers with the same helpers

`src/server/app.ts` exports one route of the app's own, asked before the router, and it uses
this same set — there is no second one:

```ts #server/app.ts — excerpt
export default (request: Request) =>
    new URL(request.url).pathname === '/robots.txt'
        ? new Response('User-agent: *')
        : undefined
```

Returning `undefined` hands the request on to routing.

Read on: [Lifecycle](../app/run-code-at-start-and-stop.md)

## Next

* [Streaming data](send-data-as-it-arrives.md) — `jsonl` and `sse`, the two streaming helpers
* [Handler URLs](find-the-url-a-handler-answers-on.md) — reaching a handler's raw `Response`
* [Manual rendering](../pages/render-a-document-yourself.md) — `render` and its shell, in full
