---
title: Watch a room from the terminal
nav: Watch a room
intent: Join a channel from a shell and watch what it produces.
---

A room is a subject anything may write and anything may read, and a terminal is one of the
things that may read it. `abide connect` joins one and prints what arrives.

```
abide connect
> thread({ id: 'onboarding' }).tail(20)
```

## The room is the same room

There is nothing terminal-shaped about this. `thread({ id })` is the `Socket` invoked the way a
page invokes it, `tail(20)` is the same cursor, and what arrives is the same `Message`. So what
you see in the shell is what the page sees, and a discrepancy is a real one rather than a
difference between two clients.

That is the payoff of a transport that does not change the producer. A debugging tool that
speaks a different protocol is a tool whose agreement with the app has to be believed.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md) ·
[Rooms](../values/let-anything-publish-and-anything-read.md)

## `tail(n)` replays and then goes live

The cursor replays the snapshot and continues from where it ended, which is why joining midway
through a conversation shows you the conversation. It is one spelling for three handoffs —
seeding a first render, a socket that dropped and reopened, and a shell that just connected.

A reconnect sends the last `seq` it printed. Same epoch and a known cursor gets everything
after it; a moved epoch gets the tail marked as a reset, because a process that changed
incarnation cannot know what you already saw.

Read on: [History & tail](../values/keep-the-last-few-values.md)

## Publishing from a shell

`publish` works if `clientPublish` does. A room served read-only refuses a frame from outside
the process, and the shell is outside the process — so what you can do here is what a browser
could do, which is the point rather than a limitation.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## Next

* [Call a handler](call-a-handler-from-the-terminal.md) — the same shell, for an rpc
* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — the transport this joins
* [Tail a deployed app](watch-a-running-app.md) — the log room, which works the same way
