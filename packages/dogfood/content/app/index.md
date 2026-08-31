---
title: The running app
nav: Overview
intent: Config, callers, logs and health — as reactive values rather than a framework object.
---

The things every app needs, as reactive values rather than as a framework object you thread
around.

| | |
| --- | --- |
| `config()` | typed settings, validated at start — and it throws in a browser |
| `principal.authenticated` | whether this caller presented something the server accepted |
| `health` | what a load balancer reads, before your auth runs |
| `log.info(…)` | structured logs, on channels you turn on one at a time |

```abide
{#if principal.authenticated}<a href="/account">Account</a>{/if}
```

## Settings the app starts with

Config is typed and validated at start, so a bad environment fails before the first
request rather than during one. Anything that must open before traffic arrives, and
close after it stops, has a place to do it.

Read on: [Config](configure-the-app.md) · [Lifecycle](run-code-at-start-and-stop.md)

## Knowing who is calling

`principal` reads the same name on either side, so a template and a handler ask the
question identically. The raw request is there when you need what it carried.

Read on: [Auth & principal](know-who-is-calling.md) ·
[Request](read-the-incoming-request.md)

## Logs, traces and health

Logs arrive on channels you turn on one at a time, a trace id follows one request
across whatever it calls, and health answers before your auth does.

Read on: [Logging](record-what-happened.md) ·
[Tracing](follow-a-request-across-services.md) ·
[Health](tell-a-load-balancer-you-are-healthy.md)

## A content security policy with a nonce

Per-request, and without breaking the scripts the app ships itself.

Read on: [CSP](lock-down-what-the-page-may-load.md)

## Knowing the connection dropped

A value that says whether the caller can reach the app, so a page can show it, queue
around it, and recover when it comes back.

Read on: [Offline](know-when-the-browser-goes-offline.md)
