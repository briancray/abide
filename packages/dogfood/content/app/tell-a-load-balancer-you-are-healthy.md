---
title: Tell a load balancer you are healthy
nav: Health
intent: An endpoint reporting the version and uptime under an app, and what you can add to it.
covers:
  - `health`
  - `Health`
  - `onHealth`
  - `version`
  - `abide`
  - `startedAt`
examples:
  - packages/dogfood/examples/health-merge.json
---

`GET /__abide/health` answers without you declaring it. What it says by default is what a load
balancer actually asks — is this the build I expect, and how long has it been up.

```
{
    "version": "2.4.1",
    "abide": "0.9.0",
    "startedAt": "2026-03-04T09:12:44.108Z"
}
```

## The three baseline fields

| | |
| --- | --- |
| `version` | the app's version — **`0.0.0` rather than absent** where the package declares none |
| `abide` | the framework's version |
| `startedAt` | when this process came up, ISO-8601 |

`version` always being there is the useful choice: a consumer reads one shape always, and "no
version declared" is a value rather than a key that sometimes is not there.

`startedAt` is a timestamp rather than an uptime because a timestamp is stable. Two scrapes a
minute apart of the same process report the same `startedAt` and different uptimes, and only
one of those tells you a restart happened.

## `onHealth` adds to it, and the app wins

{% example health-merge %}

The `database` line is `app.ts`'s `onHealth`, and the `declare module` block beside it is what
lets a page read `account.database` as a string. What a reporter returns is merged over the
baseline, and **the app's own fields win every collision**.
That is the direction that keeps the endpoint useful: an app that has a better answer for
`version` than the one abide derived should be able to give it, and a framework overriding an
app's field would make the endpoint say something nobody wrote.

A reporter that throws, or that answers with something that is not an object, warns on
`abide:health` and the baseline still answers. A health check that fails to report is not a
health check that reports failure — the load balancer needs an answer either way, and the
warning is where the problem goes.

Read on: [Lifecycle](run-code-at-start-and-stop.md) · [Logging](record-what-happened.md)

## `health` is an rpc that takes no args

`health` is an `Rpc`, imported from `abide` and called the same way on both sides: `health()` in
a page, `await health()` in a handler. The call is what asks, so a page that never makes it
loads no account.

{% snippet health-merge src/ui/components/HealthMergeAccount.abide const account %}

It is **seeded like any rpc**, which means the browser's own call on hydration is answered from
the seed buffer rather than by the reporter running again (25.3, 41.5).

## The endpoint passes the app's rungs

`/__abide/health` goes through `middleware` like every other address — the `x-served-by` rung in
`app.ts` stamps it too. So an app-wide rung that refuses a caller with no credentials has to let
this address through. A load balancer presents none, and a health check a 401 rung can fail
reports the auth layer rather than the app.

It answers `no-store`, because it describes this process at this moment. A cached health check
is a load balancer being told a drained instance is fine.

Read on: [Authorization](../server/decide-who-may-call-what.md) ·
[Response types](../server/answer-with-something-other-than-json.md)

## Next

* [Lifecycle](run-code-at-start-and-stop.md) — where `onHealth` is registered
* [Tail a deployed app](../ship/watch-a-running-app.md) — reading this from a terminal
* [Ambient values](../reference/ambient-values.md) — `health` beside the rest
