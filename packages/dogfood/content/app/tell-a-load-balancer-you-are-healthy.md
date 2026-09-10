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
| `version` | the app's version — **empty rather than absent** where there is none |
| `abide` | the framework's version |
| `startedAt` | when this process came up, ISO-8601 |

`version` being empty rather than absent is the useful choice: a consumer reads one shape
always, and "no version declared" is a value rather than a key that sometimes is not there.

`startedAt` is a timestamp rather than an uptime because a timestamp is stable. Two scrapes a
minute apart of the same process report the same `startedAt` and different uptimes, and only
one of those tells you a restart happened.

## `onHealth` adds to it, and the app wins

```ts #server/app.ts — excerpt
import { onHealth } from 'abide'

onHealth(async () => ({
    database: await database.ping(),
    queueDepth: queue.size,
}))
```

What it returns is merged over the baseline, and **the app's own fields win every collision**.
That is the direction that keeps the endpoint useful: an app that has a better answer for
`version` than the one abide derived should be able to give it, and a framework overriding an
app's field would make the endpoint say something nobody wrote.

A reporter that throws, or that answers with something that is not an object, warns on
`abide:health` and the baseline still answers. A health check that fails to report is not a
health check that reports failure — the load balancer needs an answer either way, and the
warning is where the problem goes.

Read on: [Lifecycle](run-code-at-start-and-stop.md) · [Logging](record-what-happened.md)

## `health` is a value, seeded like an rpc

`health` is a `Reactive<Health>`, so a status page reads it by name and follows it. It is
**seeded like an rpc**, which means a page rendered on the server already has the answer inline
and does not fetch it again on hydration.

```abide #ui/pages/status/page.abide — excerpt
<ul class="fields">
    <li><span>version</span><strong>{health.version}</strong></li>
    <li><span>up since</span><strong>{health.startedAt}</strong></li>
</ul>
```

## The endpoint is outside the onion

`/__abide/health` is answered **outside middleware**, for the same reason a CORS preflight is:
it carries no credentials, so there is nothing for a rung to authorise. A health check that a
401 rung can fail is a health check that reports the auth layer rather than the app.

It answers `no-store`, because it describes this process at this moment. A cached health check
is a load balancer being told a drained instance is fine.

Read on: [Authorization](../server/decide-who-may-call-what.md) ·
[Response types](../server/answer-with-something-other-than-json.md)

## Next

* [Lifecycle](run-code-at-start-and-stop.md) — where `onHealth` is registered
* [Tail a deployed app](../ship/watch-a-running-app.md) — reading this from a terminal
* [Ambient values](../reference/ambient-values.md) — `health` beside the rest
