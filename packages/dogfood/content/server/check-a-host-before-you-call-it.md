---
title: Check a host before you call it
nav: Reachable hosts
intent: Refuse at once while a host is down, rather than waiting out a timeout per call.
covers:
  - `reachable`
examples:
  - packages/dogfood/examples/reachable-host.json
---

A handler that calls another service inherits that service's bad day. The catalog API goes
down, every request that needs it waits out a network timeout, and thirty of them arriving in
those seconds each wait their own.

`reachable` asks the host once and remembers the answer, so the thirty are refused at once.

## The form of `reachable`

| You write | What you get |
| --- | --- |
| `await reachable('api.example.com')` | whether the host answered, asked over https |
| `await reachable('http://billing.internal:8080')` | the same, of an origin asked as written |

There is one form and no options. It is a server name, imported from `abide/server`, and its
signature is in the [Helpers](../reference/helpers.md) reference.

## `reachable` goes ahead of the call

{% example reachable-host %}

Ask, and refuse where the answer is no. The first send waits out the five-second probe (23.11);
every send after it in the next minute is answered from what that probe learned and refused at
once (23.12), which the message's own timing shows.

The refusal is an ordinary one, so the page that called renders it the way it renders any
other — see [Failures](refuse-a-request-and-say-why.md).

## `reachable` holds each host's answer for a minute

The first ask of a host sends one `HEAD` to it. Every ask of that host in the 60 seconds after
it is answered from what the first one learned, by every caller in the process.

That is what the name is for. A host that is down costs one probe a minute instead of one
timeout per request, and a host that is up costs one `HEAD` a minute on top of the calls
themselves. Asks that arrive while the probe is in flight share it rather than sending more.

So the answer can be a minute old in either direction. A host that came back is refused for
the rest of its minute, and a host that just went down is called once more by each request
inside it — the call's own failure is still yours to handle.

## Any answer from the host counts as reachable

| The probe | `reachable` |
| --- | --- |
| answered `200`, `404` or `500` | `true` |
| was refused, or the name did not resolve | `false` |
| went 5 seconds unanswered | `false` |

The question is whether something is there to call, and a `404` for `/` came from something.
Whether the host is healthy is a different question, and the call that follows answers it.

## Next

* [Failures](refuse-a-request-and-say-why.md) — what a caller gets when the answer is no
* [Limits](put-a-ceiling-on-a-request.md) — a ceiling on the call that does go ahead
