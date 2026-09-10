---
title: Call your app from a test
nav: Tests
intent: Hold the app the way a host holds it — no port, and no second client to keep in step.
covers:
  - `createApp`
  - `App`
  - `App.fetch`
  - `App.run`
  - `App.listen`
  - `App.stop`
---

```ts server
import { createApp } from 'abide'

const app = await createApp()

const answer = await app.fetch(
    new Request('http://app.invalid/__abide/rpc/contacts/getContact?id=42'),
)
```

`createApp` builds the app — the route table, the middleware onions, the config read, and
`onStart` around all of it. What it does not build is a socket. The app can answer before
anything is listening, and `app.fetch` is how you ask it to.

## The app is an object, and a host is one caller

| | |
| --- | --- |
| `createApp()` | tables, onions, config, `onStart` |
| `app.fetch(request)` | the whole request path, in this process |
| `app.run(fn, { request })` | one scope, with your function inside it |
| `app.listen({ port })` | the socket |
| `app.stop()` | drain, then `onStop` |

`abide start` calls the first, then the fourth, then eventually the last. A test calls the
first, then the second or the third, then the last. Same object, same route table, same
rungs — what differs is that nothing is bound.

Read on: [Build & start](build-and-serve-the-app.md) ·
[Lifecycle](../app/run-code-at-start-and-stop.md)

## `app.fetch` answers what the wire answers

A `Request` in and a `Response` out, through everything a served request goes through: the
middleware in registration order, the argument coercion, the timeout, the generated headers,
and the status a refusal carries.

```ts server
expect(answer.status).toBe(200)
expect(answer.headers.get('traceresponse')).not.toBeNull()
```

Those are the parts a handler called directly does not have, which is the reason to reach for
a request at all. Assert on the response and you are asserting on what a browser would have
been sent.

Read on: [Call a handler](call-a-handler-from-the-terminal.md)

## `app.run` is a scope and nothing else

Calling a handler by name already runs its body, its rungs and its schema. What it needs from
you is a scope — the thing a cache entry is filed under, and the lifetime a request-local
value belongs to.

```ts server
const loads = await app.run(async () => {
    await Promise.all([getContact({ id: '42' }), getContact({ id: '42' })])
    return database.contact.find.calls
})

expect(loads).toBe(1)
```

Two reads of one key in one scope are one load, and a second `app.run` loads again. Your
function's return value comes back out, so the assertion is on whatever you were watching.

Hand it a request and the ambients come alive: `request()`, `cookies()` and `response()` read
and write against the one you passed.

```ts server
await app.run(() => getContact({ id: '42' }), {
    request: new Request('http://app.invalid/', {
        headers: { cookie: 'session=abc' },
    }),
})
```

Leave it out and those three throw, which is what they do in a job or a script too.

Read on: [Request](../app/read-the-incoming-request.md)

## Bind a port only where a test needs the socket

`app.listen({ port: 0 })` takes whichever port is free, and that is the form to reach for when
a test needs `server()` or a real `WebSocket` rather than a `Request`. Everything else stays
off the network, so two test files holding an app are not queueing for the same number.

## Stop the app, or the suite hangs

`app.stop()` stops accepting, waits for what is in flight, ends live streams, closes sockets
and clears the timers the app holds — and then `onStop` runs. A file that builds an app and
never stops it leaves a timer standing, and a suite that hangs reports nothing at all: no
failure, no summary, nothing to read.

## There is no test client

Nothing is generated for tests and there is nothing to keep in step. An rpc is one callable on
both sides, and a rung runs on the in-process call as much as on the wire one — so what a test
is missing was never a caller. It is a scope and a door, and those are `app.run` and
`app.fetch`.

Read on: [Reading data](../server/read-data-without-writing-an-api.md)
