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
  - `cache-control: private, max-age=<ttl>`
  - `cache-control: public, max-age=31536000, immutable`
examples:
  - packages/dogfood/examples/json-null.json
  - packages/dogfood/examples/page-issued.json
  - packages/dogfood/examples/redirect-avatar.json
---

Most handlers return a value and never think about a `Response`. Some have to: a sign-in that
sets a cookie and sends the browser somewhere, an export that is a CSV, a preview that is a
whole document.

Return what a helper hands back. Each one writes through `response`, the response being built for
this request, and hands its argument back. A status, a header or a `set-cookie` is written there
too, so a cookie and the navigation after it are one return, with no response middleware between.

## The response helpers

| You return | The caller gets |
| --- | --- |
| `page(body)` | `text/html`, streamed as the render yields it |
| `json(value)` | the same serialization a bare return gets, fixed |
| `redirect(to, status?)` | a navigation, at one of five statuses |
| `jsonl(values)` / `sse(values)` | a stream, framed two ways |

None of them does the work of producing what it sends — `page` takes what a render produced
rather than rendering. Every signature is in the [Transports](../reference/transports.md) reference.

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

## A returned `Blob` is served by range

A `Blob` has `size` and `slice`, which is the whole of what range serving needs — so abide reads
`Range`, honours `If-Range` against the ETag it derives, and answers `206` with `content-range`,
`416` where the range is unsatisfiable and `304` on a matching `If-None-Match`. `Bun.file(path)`
IS a `Blob`, so serving a file that seeks is returning one:

```ts #server/rpc/media.ts
export const playFile = GET(async ({ id }: { id: number }) => {
    const path = await pathFor(id)
    return Bun.file(path)
})
```

*0 lines of range parsing* — against the sixty every media server writes once and gets
`content-length` on a `206` wrong the first time, a player that will not seek being the only
symptom. Reach it from markup with [`playFile.url({ id })`](find-the-url-a-handler-answers-on.md).

A handler returning a whole `Response` instead — a playlist at `no-store` beside the segments it
names at `immutable` — is answering the same way, with one consequence worth knowing: `clients.mcp` and
`clients.cli` default to **false**, a `Response` having no output schema to publish. Turn them
back on where the body is JSON you wanted a header on.

Read on: [Reading data](read-data-without-writing-an-api.md) · [Streaming data](send-data-as-it-arrives.md)

## `json` answers `null` where a bare return says nothing

{% example json-null %}

*1 helper, 0 special cases* — the arm spells the `?? null` out, and a route that forgets it
answers an empty body the script's `json()` throws on.

A bare `undefined` is a 204 with no body (16.31), which is right for a write with nothing to report
and wrong for a read whose answer is "nobody". `json` sends `null` at the status written through
`response`, 200 unless something wrote another (17.10). It is the same serialization a bare return
gets otherwise, fixed, so nothing a caller's `Accept` asks for moves it off JSON.

## `page` answers with a document

{% example page-issued %}

*1 helper, 0 headers* — the arm sets `text/html` itself, and an answer without it is text a
browser is told by `nosniff` not to guess at.

`page` takes what a render **produced** rather than doing the render — a stored copy, as here, or
the bytes `render` hands back from one of the app's own components, which
[Manual rendering](../pages/render-a-document-yourself.md) runs as a preview. Either way it is
`text/html`, the bytes as they were built.

## `redirect` sends the caller on to another address

{% example redirect-avatar %}

*0 addresses written twice* — the arm spells the photo route's path and query a second time in the
`location` it builds, and `photo.url()` is the handler's own address.

```ts shared
type RedirectStatus = 301 | 302 | 303 | 307 | 308
```

The status is restricted to those five, defaulting to `302`, so a typo is a compile error rather
than a browser quietly ignoring the header. A sign-in's cookie is written through `cookies` before
the return, so the cookie and the navigation after it are one answer.

`303` is the one a mutation wants: it turns a `POST` into a `GET` at the destination, which stops
a refresh re-submitting. A `POST` that returns a plain value to a form navigation
already gets a `303` back to the `Referer` without you writing one.

Read on: [Mutations](change-something-on-the-server.md) ·
[Links & navigation](../pages/link-to-another-page.md)

## `nosniff` is on every response, unconditionally

Every abide response declares its own content type, so a browser guessing a different one is only
ever the vulnerability — a JSON refusal sniffed as HTML is script running on your origin.

It is spelled a second time on the asset route, which is served in front of the pipeline and
never reaches the funnel.

## A `cache-control` default is the handler's to override

`cache-control` on a page, an rpc answer or a refusal is a **default**, not a rule — every
helper takes a `ResponseInit`, so a handler that knows its answer is shareable overrides it:

| Default | On | Why |
| --- | --- | --- |
| `private, no-store` | a page, an rpc answer, any refusal | a page renders per request and a handler answers as whoever called it. Absent is not neutral: it licenses a shared cache to invent a lifetime for an answer that names who asked |
| `private, max-age=<the `ttl`>` | a `GET` over a [`global`](../values/load-once-per-set-of-arguments.md) `reactive` | one number, not two — `private` because access is not something a rung can be read for, and nothing at all for `ttl: Infinity`, which no cache can be told |
| `no-store` | `/__abide/health`, `/__abide/principal` | both describe this process or this caller at this moment. A cached health check is a load balancer being told a drained instance is fine |
| `public, max-age=31536000, immutable` | the built bundle | a chunk is addressed by its own content hash, so it cannot go stale |

The method decides the **ceiling** on that override: a `GET` answer can be made shareable and a
`POST` answer cannot be, whatever it sets.

Read on: [Mutations](change-something-on-the-server.md) ·
[Health](../app/tell-a-load-balancer-you-are-healthy.md) ·
[Build & start](../ship/build-and-serve-the-app.md)

## An app route answers with the same helpers

`src/server/app.ts` exports one route of the app's own, asked where no page, handler or public
file answered, and it uses this same set — there is no second one. Returning `undefined` hands
the request on to the 404.

Read on: [Lifecycle](../app/run-code-at-start-and-stop.md)

## Next

* [Streaming data](send-data-as-it-arrives.md) — `jsonl` and `sse`, the two streaming helpers
* [Handler URLs](find-the-url-a-handler-answers-on.md) — reaching a handler's raw `Response`
* [Manual rendering](../pages/render-a-document-yourself.md) — `render` and its shell, in full
