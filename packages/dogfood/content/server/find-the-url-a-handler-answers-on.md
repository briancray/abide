---
title: Find the URL a handler answers on
nav: Handler URLs
intent: Hand the address to something outside abide — a webhook, a form, a curl.
covers:
  - `rpc.url`
  - `rpc.method`
  - `rpc.raw`
  - `rpc.description`
---

Inside the app you never write an address down: you import the handler and call it. Something
outside the app cannot — a payment provider that needs a webhook URL, a `<form action>`, a
colleague who wants a `curl` line.

The handler carries the address, so the string is derived rather than typed:

```abide #ui/pages/settings/page.abide — excerpt
<form action={payInvoice.url()} method={payInvoice.method}>
    <input name="id" value={route.params.id}/>
    <button>Pay</button>
</form>
```

*0 hardcoded paths* — rename the export and the form follows.

## `rpc.url` is derived, not baked

The generated wrapper carries a **mount-relative** address. `url` resolves it at read time:

| Where | Against |
| --- | --- |
| a browser | `<meta name="abide-mount">` in the document |
| a server | `config().APP_URL` |

A mount is chosen after the build — `APP_URL` of `https://abide.com/v2` serves every page,
endpoint and asset under `/v2` — so a build artifact cannot hold the absolute form. That is
what makes the same bundle deployable at a sub-path without a rebuild.

## `rpc.url` takes the args on a read

An address without its arguments is not something a browser can fetch, so on a `GET` or a `DELETE`
the call takes them — written in the same canonical wire form the request itself uses, rather than
a query string you assemble and the server parses back differently:

```abide #ui/pages/media/page.abide — excerpt
<video src={playFile.url({ id: file.id })} controls></video>
<img src={getPoster.url({ path, width: 250 })} alt="">
```

That is how a handler is reached from markup at all, and it is the only surface a handler serving
bytes has. On a mutation it takes nothing and is called bare — `payInvoice.url()` above — the body
being where those arguments go.

Read on: [Sub-path mounting](../pages/serve-the-app-under-a-sub-path.md) ·
[Config](../app/configure-the-app.md)

## `rpc.method` says which verb the address wants

The method the handler was declared with, as a string. Reading it rather than writing `"post"`
keeps a form correct when a handler is redeclared — and only `GET` and `POST` are
form-reachable, so a `PUT` moved to a form is a bug the value makes visible.

Read on: [Mutations](change-something-on-the-server.md)

## The address comes from the file path and the export name

| File | Export | Answers at |
| --- | --- | --- |
| `#server/rpc/name.ts` | `default` | `/__abide/rpc/name` |
| `#server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` |
| `#server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |

So the address is readable from the source tree, which is what a log line or a network panel is
for. What it is not is a thing to write out: the route table is a build artifact, and a
collision between two files that mount at one address is a build error naming both.

## `rpc.raw` hands back the `Response`

Where you want the `Response` rather than a decoded value — a header to read, a `Blob` to hand
to a download, a body you will frame yourself:

```ts browser
const response = await downloadLedger.raw(
    { year: 2026 },
    { headers: { accept: 'text/csv' } },
)
const disposition = response.headers.get('content-disposition')
```

It takes a `RequestInit`, so it is also how a caller sends an `Accept` a streaming handler
answers differently — jsonl or SSE at the same address.

What you give up is everything the `Reactive` was doing: no coalescing, no `ttl`, no probes, no
seeding. Reach for it when the response **is** the thing you want, and for the ordinary call
otherwise.

Read on: [Streaming data](send-data-as-it-arrives.md) · [Reading data](read-data-without-writing-an-api.md)

## `rpc.description` is the sentence every surface carries

The string you passed as `description`, readable back off the handler. The same one rides onto
the OpenAPI operation, the MCP tool and the CLI command — one place to write it, and no
surface can carry a different sentence than another.

```ts server
export const getInvoice = GET(invoiceById, {
    description: 'One invoice, by id.',
})
```

Read on: [OpenAPI](../machines/describe-your-api-without-writing-a-spec.md) ·
[MCP](../machines/let-a-model-call-your-handlers.md)

## A webhook takes `rpc.url` read on the server

A provider that calls you wants an absolute URL, which is `rpc.url` read on the server:

```ts #server/app.ts — excerpt
onStart(async (start) => {
    await payments.registerWebhook(paymentSettled.url())
    await start()
})
```

The handler on the other end of that is an ordinary `POST`, and a caller that is not a browser
sends no `Origin` — which the mutation gate allows on purpose, there being no ambient cookie to
abuse. Authenticating that caller is a rung.

Read on: [Authorization](decide-who-may-call-what.md) · [Lifecycle](../app/run-code-at-start-and-stop.md)

## Next

* [Call a handler](../ship/call-a-handler-from-the-terminal.md) — the same handler from a shell
* [Sub-path mounting](../pages/serve-the-app-under-a-sub-path.md) — why the address is relative
* [Withholding a surface](../machines/keep-a-handler-off-a-surface.md) — an address that answers but is not listed
