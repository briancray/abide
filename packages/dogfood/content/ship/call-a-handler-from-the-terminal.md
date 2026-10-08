---
title: Call a handler from the terminal
nav: Call a handler
intent: Run an rpc from a shell — the argument schema decides the flags.
covers:
  - `abide [--url <origin>] [--port <n>]`
  - `abide call <address> [args]`
---

```
abide call invoices/getInvoice id=4310
```

One call to one handler. The address is the mount path without the `/__abide/rpc/` prefix, and
the arguments are the ones the handler declared — read by the app the call reaches, against the
schema it holds every caller to.

An argument is `name=value`, and a name given twice is a list. The value is text until the
handler's schema says otherwise, so `id=4310` arrives as a number where `id` is declared one —
the same reading a `GET`'s query string gets (38.62). An argument shape one word per name cannot
spell, an object inside an object, is typed as one JSON object instead:

```
abide call invoices/createInvoice '{"customer": {"id": "c-9"}, "lines": []}'
```

## The schema is the interface

A handler's argument shape is what the app holds the call to, so a mistyped argument is refused
with a message naming the field, and `call` exits 7. That is the same schema the browser wrapper
is built from and the same one OpenAPI publishes; there is one per handler and the CLI is a
reader of it.

Read on: [Schemas](../server/check-what-callers-send-you.md) ·
[Logging](../app/record-what-happened.md)

## Exit codes tell a refusal from a fault

| | |
| --- | --- |
| `0` | the handler answered |
| `7` | the handler **refused** |
| `8` | the call reached the app and the app faulted |

A refusal is an expected answer, so it is not a failure of the CLI. A script can branch on
those two without parsing anything, which is the difference between a deploy check that can act
on "not yours" and one that can only retry.

Read on: [Failures](../server/refuse-a-request-and-say-why.md)

## `abide` alone is the interactive form

```
abide                              # the built app, served, and a shell on it
abide --url https://ledger.example # a shell on a running app
```

A shell on the app: the handlers are in scope, the completions come from the same
route table, and a call is a call. `help` lists what it takes and `handlers` every address; Tab
completes an address or an argument name, and the handler's arguments are shown as you type.
Ctrl+C clears the line, or cancels a call still running. It is for the questions that are
one-off by nature — what does this record look like, does this handler still refuse that — where
writing a script is more ceremony than the question deserves.

`abide logs` is the same kind of connection, made to one channel: a live subscription to
`log.records`, the one the shell makes to any channel (38.10). That is the shape worth
noticing — a built-in that turns out to be an ordinary subscription cannot drift from the thing it
reads.

Read on: [Logging](../app/record-what-happened.md)

## Which app, and with what

`--url`, then `ABIDE_APP_URL`, then the local app. `ABIDE_APP_TOKEN` is the bearer sent with
it, so a remote app is reachable without a second set of credentials to manage.

Both are ordinary environment variables, which means a shell profile per environment is the
whole of the setup.

Read on: [Tail a deployed app](watch-a-running-app.md) ·
[Configuration](../reference/configuration.md)

## Next

* [Tail a deployed app](watch-a-running-app.md) — the same connection, for logs
* [Watch a channel](watch-a-room-from-the-terminal.md) — the same connection, for a channel
* [CLI](../reference/cli.md) — every command and flag
