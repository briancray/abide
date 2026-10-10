---
title: Watch a channel from the terminal
nav: Watch a channel
intent: Follow a GET from a shell and watch its value change.
covers:
  - `abide watch <address> [args]`
---

A channel is an array every caller follows, and a terminal is one of the things that may follow
it. `watch` follows a `GET` and prints its value, then the value again after each patch (38.70).

```
abide
> watch chat/room id=onboarding
```

The address is the handler's mount path below `/__abide/rpc` — the file under `#server/rpc` and the
export — and the args are `name=value` words or one JSON object, as `call` takes them. Against a
deployed app it is a command of its own:
`abide watch chat/room id=onboarding --url https://app.example`.

## The channel is the same channel

There is nothing terminal-shaped about this. `watch` asks the `GET` for the event stream any
client may ask for (18.20), and that stream carries what the page's mux carries, frame for frame.
So the array is the same array and the messages are the same messages. What you see in the shell is
what the page sees, and a discrepancy is a real one rather than a difference between two clients.

That is the payoff of one follow for every client. A debugging tool that speaks a different protocol
is a tool whose agreement with the app has to be believed.

A `GET` not answered from a `global` value has nothing to follow, so it answers once and `watch`
prints it once.

Read on: [Live updates](../server/keep-a-room-of-callers-in-sync.md) ·
[Channels](../values/let-anything-publish-and-anything-read.md)

## The value first, then its patches

A follow is sent the value with its version, then what each patch wrote as JSON Patch (18.6,
18.11), which is why joining midway through a conversation shows you the conversation. It is one
mechanism for three handoffs — seeding a first render, a connection that dropped and reopened, and
a shell that just connected.

A reconnect names the version it last held (18.9). Where that is still the value's version nothing
is resent; anywhere else, a restarted process included, the value is sent whole, because a version
names one production or patch in no other process (18.7).

## The shell watches, and does not write

`watch` only reads. The way into a channel from outside the process is a `POST` whose handler
patches it, so to change a room from a terminal, `call` that handler as a page would. Its rungs
decide whether the shell may, the same as for any caller (16.11).

Read on: [Live updates](../server/keep-a-room-of-callers-in-sync.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## Next

* [Call a handler](call-a-handler-from-the-terminal.md) — the same shell, for an rpc
* [Live updates](../server/keep-a-room-of-callers-in-sync.md) — the `GET` this follows
* [Tail a deployed app](watch-a-running-app.md) — `log.records`, an array read the same way
