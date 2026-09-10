---
title: Call a handler from the terminal
nav: Call a handler
intent: Run an rpc from a shell — the argument schema decides the flags.
covers:
  - `abide connect [url]`
  - `abide call <address> [args]`
---

```
abide call invoices/getInvoice '{"id": "4310"}'
```

One call to one handler. The address is the mount path without the `/__abide/rpc/` prefix, and
the arguments are the ones the handler declared — checked before the call goes out, because the
schema is already there.

## The schema is the interface

A handler's argument shape is what the CLI validates against, so a mistyped argument is a
message naming the field rather than a `422` you read back out of a response body. That is the
same schema the browser wrapper is built from and the same one OpenAPI publishes; there is one
per handler and the CLI is a reader of it.

`abide logs` is this command on `log.records`, which is the shape worth noticing: a built-in
that turns out to be an ordinary call is a built-in that cannot drift from the thing it wraps.

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

## `abide connect` is the interactive form

```
abide connect https://ledger.example
```

A shell against a running app: the handlers are in scope, the completions come from the same
route table, and a call is a call. It is for the questions that are one-off by nature — what
does this record look like, does this handler still refuse that — where writing a script is
more ceremony than the question deserves.

## Which app, and with what

`--url`, then `ABIDE_APP_URL`, then the local app. `ABIDE_APP_TOKEN` is the bearer sent with
it, so a remote app is reachable without a second set of credentials to manage.

Both are ordinary environment variables, which means a shell profile per environment is the
whole of the setup.

Read on: [Tail a deployed app](watch-a-running-app.md) ·
[Configuration](../reference/configuration.md)

## Next

* [Tail a deployed app](watch-a-running-app.md) — the same connection, for logs
* [Watch a room](watch-a-room-from-the-terminal.md) — the same connection, for a channel
* [CLI](../reference/cli.md) — every command and flag
