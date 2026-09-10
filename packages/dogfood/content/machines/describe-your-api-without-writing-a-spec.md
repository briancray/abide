---
title: Describe your API without writing a spec
nav: OpenAPI
intent: An OpenAPI document generated from the handlers you already declared.
covers:
  - `/__abide/openapi.json`
  - `abide:openapi`
  - `OpenApiDocument`
  - `abide openapi [--out <file>] [--url <origin>]`
  - `ABIDE_OPENAPI`
---

A handler already carries everything a spec needs: an address, a method, an argument schema, a
description and a set of declared refusals. `/__abide/openapi.json` is those, arranged as
OpenAPI 3.1.

```
ABIDE_OPENAPI=1 abide start
```

## The document is generated from the route table

The document is served from a **memo over the route table**, and it takes no `ttl` — there is
nothing to go stale against, the route table being what it is derived from. So a handler added
is an operation published, and there is no regeneration step to forget.

`OpenApiDocument` is OpenAPI 3.1, whose schema dialect **is** `JsonSchema`. That is why a
handler's schema is published with **no translation**: the native form is already the published
form, and a translation layer is where a spec starts disagreeing with the thing it describes.

Where a `Schema` carries its own JSON Schema, that is what is published — abide probes one
spelling for it, which is the one Standard Schema implementations expose. Where it has none, the
**type-derived** `JsonSchema` is published instead, which is the schema your annotation already
built.

A handler whose schema has no JSON Schema export at all warns on `abide:openapi`. The operation
is still published; the warning is there because an operation with a weaker schema than the
handler enforces is a document that promises less than the app does.

Read on: [Schemas](../server/check-what-callers-send-you.md) ·
[Logging](../app/record-what-happened.md)

## Off by default, and gated by one variable

`ABIDE_OPENAPI` opts the address in. Off is the right default: an app's API description is a
map of its endpoints, and publishing one is a decision rather than a consequence of using a
framework.

The address runs inside the app's own middleware like every `/__abide/**` address, so a rung
that refuses anonymous callers refuses this too.

## Written rather than served

```
abide openapi --out dist/openapi.json
```

The same document, produced from the source rather than asked of a server. That is what a build
step wants — a spec committed beside the code, or handed to a client generator — and it does
not require the app to be running or the address to be on.

`--url` points it at a running app instead, which is what you want when the question is what
*that deployment* is serving.

Read on: [CLI](../reference/cli.md)

## What the document leaves out

`clients: { openapi: false }` withholds an operation from the listing and changes nothing about
the address. A handler withheld is still callable, and a handler whose rung would refuse you is
**still listed** — the document is a catalogue, not a permission set.

Read on: [Withholding a surface](keep-a-handler-off-a-surface.md)

## Next

* [MCP](let-a-model-call-your-handlers.md) — the other generated surface
* [Withholding a surface](keep-a-handler-off-a-surface.md) — keeping an operation out
* [Schemas](../server/check-what-callers-send-you.md) — where the published schema comes from
