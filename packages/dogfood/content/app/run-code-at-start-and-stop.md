---
title: Run code at start and stop
nav: Lifecycle
intent: Open a pool before the first request, close it after the last one.
covers:
  - `default`
  - `onStart`
  - `onStop`
  - `src/server/app.ts`
---

`src/server/app.ts` is the file that always runs at startup. It is where the app's own route
goes, and where the hooks that wrap the boot are registered.

```ts #server/app.ts
import { onStart, onStop } from 'abide'
import { database } from '#server/database'

onStart(async (start) => {
    await database.connect()
    await start()
})

onStop(async (stop) => {
    await stop()
    await database.close()
})
```

## A hook wraps, it does not listen

`onStart` takes the **next step** as an argument rather than being notified that a step
happened. That is the whole difference: work before `await start()` is work the first request
cannot race, and work after it is work that knows the app is up.

A listener cannot promise either. It fires alongside the thing it is about, and every ordering
question it raises has to be answered by a second mechanism.

| | |
| --- | --- |
| before `await start()` | the app cannot answer yet |
| after `await start()` | it can, and this knows it |
| a wrap that **throws** | fails hard; the server does not come up |

Failing hard is the only useful answer to a failed migration. An app that starts anyway is an
app serving requests against a schema it did not get.

`onStop` mirrors it. `await stop()` first, then tear down what you opened — so a connection is
closed after the last request that could have used it, not during.

## Every hook hands back the way off

```ts server
const off = onStart(warmCaches)
off()
```

That is what makes these registrable from whatever module owns the thing they are about, rather
than only from `app.ts`. A module torn down in a test can remove its own hook, and `app.ts` is
the right home for the app-wide ones only because that file always runs.

Read on: [Config](configure-the-app.md) · [Authorization](../server/decide-who-may-call-what.md)

## `default` is the app's own route

The default export is a route asked **before the router** — one function, the same `Request` in
and a `Response` or `undefined` out:

```ts #server/app.ts — excerpt
export default (request: Request) =>
    new URL(request.url).pathname === '/robots.txt'
        ? new Response('User-agent: *')
        : undefined
```

Returning `undefined` hands the request on to routing. It uses the same response helpers
everything else does, there being no second set.

An object with a `fetch` is accepted too, which is the shape a `Bun.serve` handler already has —
so an existing handler moves in without being rewritten.

Read on: [Response types](../server/answer-with-something-other-than-json.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## Next

* [Config](configure-the-app.md) — `onConfig`, registered the same way
* [Health](tell-a-load-balancer-you-are-healthy.md) — `onHealth`, registered the same way
* [Configuration](../reference/configuration.md) — every hook in one table
