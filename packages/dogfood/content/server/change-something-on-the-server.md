---
title: Change something on the server
nav: Mutations
intent: Write, and have a double-click be one write rather than two.
covers:
  - `POST` / `PUT` / `PATCH` / `DELETE`
  - `server/rpc/admin/audit.ts`
---

A read is safe to repeat. A write is not — and a browser repeats one for you: a double-click,
an impatient tap on a slow connection, a form submitted twice.

Declare the handler with the method that says what it does. The repeat is handled by the
declaration rather than by a flag you remember to set.

```ts #server/rpc/invoices.ts
import { POST } from 'abide'
import { database } from '#server/database'

export const payInvoice = POST(
    ({ id }: { id: string }) => database.invoice.pay(id),
    { description: 'Mark one invoice paid.' },
)
```

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<button onclick={() => payInvoice({ id: route.params.id })}>Pay</button>
```

*2 files, 0 in-flight flag* — two clicks inside one flight are one write, and the second
click gets the first one's answer.

## `POST`, `PUT`, `PATCH` and `DELETE` declare a write

Each takes exactly what [`GET`](read-data-without-writing-an-api.md) takes — a memo, a
channel, or a plain function that becomes one — and mounts at the same file-path address.
The method is the whole per-method difference, and what it changes is retention.

## A mutation retains nothing by default

A memo handed to a mutation has its `ttl` **defaulted to 0** unless the memo named one. A
`ttl` of 0 coalesces until the response closes and no longer:

| | Result |
| --- | --- |
| two clicks inside one flight | one request, one write, both callers get that answer |
| two clicks after the first closed | two requests, two writes |
| three components calling in one render | one request |

That is the window that wants sharing — the rest of what a `ttl` buys a read is exactly what
a write must not have.

Read on: [Caching](../values/load-once-per-set-of-arguments.md)

## A `ttl` on the memo caps a write to once per period

Where a write genuinely must not run twice in a period, name the `ttl` on the memo and hand
that to the method:

```ts #server/rpc/invoices.ts — excerpt
const sendReminder = memo(({ id }: { id: string }) => mailer.remind(id), {
    ttl: 3_600_000,
})

export const remindAboutInvoice = POST(sendReminder)
```

One reminder per invoice per hour, whoever asks and however often.

## A memo belongs to exactly one handler

Handing the same memo to two handlers is a **build error naming both**. It is not a
restriction so much as a shape that never worked: `GET(user)` and `POST(user)` over one memo
either have the `POST` quietly stop the `GET` caching, or share one entry table under two
freshness rules — where a `POST` populating an entry the `GET`'s 60s keeps fresh serves the
second click the first click's response and **the write never happens**.

The repair is what the shapes wanted anyway. A read memo and a write memo have different
`Args`.

## Arguments travel in the body

`POST`, `PUT` and `PATCH` carry their arguments as the request body, so `Args` is the full
`JsonValue` — a nested object is fine. `DELETE` carries URL parameters like a `GET`, so its
arguments are flat.

Three body encodings are accepted, which is what lets a plain `<form>` reach the same address
a script does:

| `content-type` | From |
| --- | --- |
| `application/json` | abide's own client wrapper, and anything else that sends JSON |
| `multipart/form-data` | a form with a file in it |
| `application/x-www-form-urlencoded` | a form without one |

## A folder is part of the address

Nesting under `#server/rpc/**` nests the address. Nothing else changes:

| File | Export | Answers at |
| --- | --- | --- |
| `#server/rpc/invoices.ts` | `payInvoice` | `/__abide/rpc/invoices/payInvoice` |
| `#server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |

A path is owned by exactly one handler. `#server/rpc/users.ts` exporting `getUser` and
`#server/rpc/users/getUser.ts` exporting `default` mount at the same address, and that is a
build error naming both files rather than whichever one won at the first request.

Read on: [Handler URLs](find-the-url-a-handler-answers-on.md)

## Cross-origin mutations are gated by default

Before the handler runs, a mutation compares its `Origin` against `APP_URL`'s origin. A
mismatch is `403`. A browser sends `Origin` on every cross-origin request, form posts
included, and script cannot set it — so the gate holds whatever the cookie policy is.

A mutation arriving with **no** `Origin` at all is allowed. CSRF needs a browser's ambient
authority and a browser always sends one, so an absent header is a non-browser caller with no
ambient cookie to abuse. Refusing those callers is your rung, not abide's.

`GET` needs no such gate, being a read. `DELETE` is unreachable by navigation, a navigation
always being a `GET`.

Read on: [CORS](let-another-origin-call-you.md) · [Authorization](decide-who-may-call-what.md)

## A form posts to a handler without script

`<form action={payInvoice.url} method="post">` posts to the address like any other caller.
Where the request **prefers** `text/html` — which is what a browser form sends and what
abide's own wrapper never sends — the answer is converted rather than serialized:

| The handler returned | The browser gets |
| --- | --- |
| a value | `303 See Other` back to the `Referer` |
| a `redirect()` | that redirect, unchanged |
| a refusal | `error.abide`, at the refusal's own status |

Without the conversion a scriptless submit navigates to a JSON document. With script, the
client intercepts `submit` and it is an ordinary call, so the conversion is reached only by
the caller that needs it.

Only `GET` and `POST` are form-reachable, a `<form>` sending no other method. There is no
`_method` override: a mutation meant to be submitted without script is declared `POST`.

Read on: [Form binding](../templates/bind-a-form-to-state.md) ·
[Error pages](../pages/show-a-page-when-something-fails.md)

## A `POST` answer is never browser-cached

What the method decides is the **ceiling**. A `GET` answer can be made shareable by the
handler's own `ResponseInit`; a `POST` answer cannot be, whatever it sets, no browser
usefully caching one. Its only cache is ever the memo's `ttl`.

So a `POST` is a legitimate read — for a query too big for a URL — and it costs the browser
cache to use one. Prefer `GET` where the arguments fit a URL, beyond what the methods mean.

Read on: [Response types](answer-with-something-other-than-json.md)

## Next

* [Failures](refuse-a-request-and-say-why.md) — refusing a write by name, with data
* [Schemas](check-what-callers-send-you.md) — checking the body before the handler sees it
* [Limits](put-a-ceiling-on-a-request.md) — how large a body, how long a call
