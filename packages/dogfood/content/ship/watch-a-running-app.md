---
title: Watch a running app
nav: Tail a deployed app
intent: Tail a deployed app's logs from your terminal.
covers:
  - `abide logs`
  - `ABIDE_APP_TOKEN`
  - `ABIDE_APP_URL`
---

```
abide logs
```

Tails the app's log records. It reads the `GET` over `log.records`, and a client reading a `GET` is
subscribed to what it produces (18.17), so this is a live subscription — the one `abide connect`
makes to any channel (38.10). That is worth stating first because it explains everything else
about it: the channel is a channel, the ring is that channel's `history`, and there is no separate
log API for this to be a client of.

## `DEBUG` is read where the app runs

Which namespaces emit is decided by the **app's** `DEBUG`, not by a flag here. That is the right
place for it — a line nothing selected is never built, so a namespace switched on at the terminal
would be asking for records that were never made.

Turning a namespace on is therefore a deployment change, and that is honest about what it costs.

Read on: [Logging](../app/record-what-happened.md)

## Which app, and with what

`ABIDE_APP_URL` names an app somewhere else and `ABIDE_APP_TOKEN` is the bearer sent with the
call. `--url` overrides the first.

The address is gated by `ABIDE_LOGS` on the app side, which opts in to declaring the `GET` over
`log.records`. Off by default: an app's log is not something to expose by accident, and the
variable is the decision.

Read on: [Config](../app/configure-the-app.md) ·
[Configuration](../reference/configuration.md)

## The tail is a memory ring

`ABIDE_MAX_LOG_BUFFER_COUNT` is how many records the channel retains, and it is bounded and
process-local like any other ring. What this command shows is what that process still holds —
so it is the tool for **what is happening now**, and a collector is the tool for what happened
last Tuesday.

`ABIDE_LOG_FORMAT` picks the machine form for that collector. Unset, the output is the readable
one, and `NO_COLOR` and `FORCE_COLOR` decide the ansi.

Read on: [History](../values/keep-the-last-few-values.md)

## Next

* [Logging](../app/record-what-happened.md) — the records this reads
* [Call a handler](call-a-handler-from-the-terminal.md) — the command this is one of
* [Health](../app/tell-a-load-balancer-you-are-healthy.md) — the other thing to scrape
