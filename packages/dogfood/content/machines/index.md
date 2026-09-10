---
title: For machines
nav: Overview
intent: One handler, four surfaces — a page, an endpoint, a tool, a command.
---

A handler you already wrote carries everything a caller needs in order to call it: an
address, a method, an argument schema, a result schema, and a description. So exposing it to
something that is not your own page is **not a second API** to build and keep in step. It is
the same handler, described again in whatever vocabulary the caller reads.

| The caller | What it reads |
| --- | --- |
| your page | the generated client — same name, same types |
| another service | an OpenAPI operation |
| a model | a tool definition |
| a script, a CI job, or you | a command — JSON down a pipe, human-readable at a prompt |

Every one of those is derived from the handler. There is no second place to update when
an argument changes, and no way for one surface to describe a handler differently from the
rest.

## What the handler already carries

Nothing here asks you to annotate a handler for machines specifically. The pieces a tool
definition and an OpenAPI operation need are the pieces `GET` and `POST` already derive.

| Piece | Where it comes from |
| --- | --- |
| address | the file path and the export name |
| method | which handler gave it an address |
| argument schema | the annotations you already wrote, or the schema you named |
| result schema | the handler's return type |
| description | `description`, the one thing worth writing by hand |

Fill in `description`. It is the sentence a model reads to decide whether this is the call it
wants, and it rides onto every surface.

## The surfaces

Two of the four are here. The CLI is the third framing of the same client, and it serves
machines as readily: a script, a CI job, an agent that can run a command but not open an MCP
session. abide's commands belong in one place, so it is written with the rest of them.

Read on: [OpenAPI](describe-your-api-without-writing-a-spec.md) ·
[MCP](let-a-model-call-your-handlers.md) ·
[Withholding a surface](keep-a-handler-off-a-surface.md) ·
[Call a handler](../ship/call-a-handler-from-the-terminal.md) ·
[Watch a room](../ship/watch-a-room-from-the-terminal.md)
