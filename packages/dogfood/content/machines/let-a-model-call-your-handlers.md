---
title: Let a model call your handlers
nav: MCP
intent: The same handlers as tool definitions, so an agent calls what your pages call.
covers:
  - `/__abide/mcp`
  - `abide mcp [--url <origin>]`
  - `abide:mcp`
  - `ABIDE_MCP`
---

An MCP server is a list of tools with typed arguments and descriptions. A declared handler is a
typed argument shape with a description. `/__abide/mcp` is the second read as the first, over
streamable http.

```
ABIDE_MCP=1 abide start
```

## The method decides tool or resource

A handler is published as a **tool** or as a **resource** according to which arm `GET` took, and
no flag tells them apart. A read is a resource, a mutation is a tool — which is the distinction
MCP already draws, arrived at from the declaration rather than from an annotation somebody has
to keep true.

That is the whole of the mapping, and it is worth being able to state in one line: the model
sees your app's verbs because your app already declared which of its handlers change something.

## The description is the handler's

`description` on `RpcOptions` is the human sentence, and it is what a model reads to decide
whether a tool is the one it wants. It is the same string that reaches the OpenAPI operation and
the CLI's help, so there is one sentence per handler rather than three that drift.

A tool published with no description warns on `abide:mcp`. A model choosing between two
undescribed tools is choosing by name, and a name is not an explanation.

Read on: [Handler URLs](../server/find-the-url-a-handler-answers-on.md) ·
[Logging](../app/record-what-happened.md)

## Refusals arrive as names, not as 500s

This is where declared refusals pay off twice. A model that gets `500` can only retry; a model
that gets `NotYours` with its data can **re-plan** — ask a different question, or tell the
person why it stopped.

That is why a declared refusal defaults to 400 rather than 500, and why `HttpError` is a name
even though nothing can narrow to it: an MCP error entry is a place a caller reads a name, and
every refusal has one.

Read on: [Failures](../server/refuse-a-request-and-say-why.md)

## Off by default, and inside the onion

`ABIDE_MCP` opts the address in, and the address runs inside the app's own middleware like
every `/__abide/**` address. So the rung that authorises a browser authorises an agent, with
nothing written twice.

A handler withheld with `clients: { mcp: false }` is absent from the tool list and answers on
its http address exactly as it did. A handler whose rung would refuse the caller is **still
listed**, and still refused on the call.

Read on: [Withholding a surface](keep-a-handler-off-a-surface.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## Over stdio, for a desktop client

```
abide mcp --url https://ledger.example
```

The same server over stdio rather than http, which is what a desktop MCP client expects.
`--url` names the app it talks to; without one it is the local app.

Read on: [CLI](../reference/cli.md)

## Next

* [OpenAPI](describe-your-api-without-writing-a-spec.md) — the other generated surface
* [Failures](../server/refuse-a-request-and-say-why.md) — what makes a refusal re-plannable
* [Withholding a surface](keep-a-handler-off-a-surface.md) — keeping a handler out of the list
