---
title: Run code at start and stop
nav: Lifecycle
intent: Open a pool before the first request, close it after the last one.
covers:
  - `default`
  - `onStart`
  - `onStop`
  - `src/server/app.ts`
examples:
  - packages/dogfood/examples/start-hook.json
---

`src/server/app.ts` is the file that always runs at startup. It is where the app's own route
goes, and where the hooks that wrap the boot are registered.

## `onStart` runs before the first request

{% example start-hook %}

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

## `onStop` closes what `onStart` opened, after the last request

{% snippet start-hook src/server/app.ts onStop( %}

`onStop` mirrors it. `await stop()` first, then tear down what you opened — so a connection is
closed after the last request that could have used it, not during. A running page cannot show
you that, and a test can: the one on [Tests](../ship/call-your-app-from-a-test.md) stops the app
and finds the pool closed.

A served app runs it however the process is told to end: `exit` in its shell, a `SIGTERM` from
`docker stop` or a deploy, `Ctrl-C`. A rejection nobody awaited or a throw nothing caught reaches
`onError` first and then stops the app the same way, exiting with 1 so a supervisor restarts a
clean process. A second signal while it is stopping ends it at once.

## Every hook hands back the way off

```ts server
const off = onStart(warmCaches)
off()
```

That is what makes these registrable from whatever module owns the thing they are about, rather
than only from `app.ts`. A module torn down in a test can remove its own hook, and `app.ts` is
the right home for the app-wide ones only because that file always runs.

Read on: [Config](configure-the-app.md) · [Authorization](../server/decide-who-may-call-what.md)

## `default` answers what nothing else does

The default export is the app's own route — one function, the same `Request` in and a `Response`
or `undefined` out. It is asked once the pages, the handlers and the public files have all passed,
so it answers an address only where nothing else would:

{% snippet start-hook src/server/app.ts export default %}

Returning `undefined` hands the request on to the 404. It uses the same response helpers
everything else does, there being no second set.

An object with a `fetch` is accepted too, which is the shape a `Bun.serve` handler already has —
so an existing handler moves in without being rewritten.

Read on: [Response types](../server/answer-with-something-other-than-json.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## Next

* [Config](configure-the-app.md) — `onConfig`, registered the same way
* [Health](tell-a-load-balancer-you-are-healthy.md) — `onHealth`, registered the same way
* [Configuration](../reference/configuration.md) — every hook in one table
