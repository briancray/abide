---
title: Record what happened
nav: Logging
intent: Structured logs under namespaces you can turn on one at a time, including abide's own.
covers:
  - `log`
  - `log.info` / `log.warning` / `log.error` / `log.debug`
  - `log.named`
  - `Logger`
  - `LogRecord`
  - `log.records`
  - `log.enabled`
  - `abide:request`
  - `abide:socket`
  - `abide:lifecycle`
  - `abide:principal`
  - `abide:health`
  - `abide:config`
  - `abide:render`
  - `abide:refuse`
  - `abide:reactive`
  - `abide:watch`
  - `abide:hydrate` / `abide:navigate`
  - `ABIDE_LOGS`
  - `ABIDE_LOG_FORMAT`
  - `ABIDE_MAX_LOG_BUFFER_COUNT`
  - `DEBUG`
  - `NO_COLOR`
  - `FORCE_COLOR`
examples:
  - packages/dogfood/examples/log-channels.json
---

`log('invoice paid', { id })` writes a line. What makes it worth having rather than a
`console.log` is everything around it: the line carries a trace, it goes under a namespace somebody
can switch off, and it is published to a channel a page can read.

## The four levels and the default namespace

```ts server
log('sending')
log.debug('cache table', { entries: cache.size })
log.info('invoice paid', { id: '4310' })
log.warning('retrying', { attempt: 2 })
log.error('mailer refused', { error })
```

`log` on its own is a message under the default namespace, which is `APP_NAME`. The four named forms
are the levels, and every one of them takes whatever arguments you give it — a message and a
record of structured data is the shape that reads well in both output formats.

## A namespace is turned on one at a time

{% example log-channels %}

*1 gate, 0 filters* — and the gate is at the call, so a line nothing selected never builds its
argument object.

`log.named(name)` hands back a `Logger` — the same shape as `log`, bound to a namespace. `DEBUG`
decides which namespaces emit, with the comma-and-wildcard grammar the ecosystem already uses, so
`DEBUG=billing,abide:*` is a sentence anybody who has used the convention can already read.

`log.enabled()` asks whether a gated line under this namespace would be written. It is for the case
where **building the argument is the expensive part**:

```ts server
if (log.enabled()) log.debug('table', { rows: expensiveSnapshot() })
```

## abide's own namespaces

Every one is namespaced `abide:`, so `DEBUG=abide:*` turns on the framework and nothing of
yours, and `DEBUG=abide:request` turns on one lane.

| Namespace | Levels | What it says |
| --- | --- | --- |
| `abide:request` | `debug` | one line per request |
| `abide:socket` | `debug` | one line per socket event |
| `abide:lifecycle` | `debug` `error` | a lifecycle that ran |
| `abide:principal` | `debug` `warning` | a principal set or cleared |
| `abide:health` | `warning` | an `onHealth` that threw or answered a non-object |
| `abide:config` | `warning` | a second `onConfig` replacing the first |
| `abide:render` | `warning` | an `error.abide` that itself failed |
| `abide:refuse` | `warning` | a message formatter that threw |
| `abide:reactive` | `warning` | a failed revalidation over a value still being served |
| `abide:watch` | `warning` | a `watch` effect or `Disposer` that threw |
| `abide:hydrate` / `abide:navigate` | `warning` | the browser lane |

The `warning` namespaces are worth reading as a list, because each is a failure that is
**otherwise silent**: a stale value still being served, an effect that threw after its first
run, an error page that could not render. None of them stops the app, and none of them shows up
anywhere else.

Read on: [Watching values](../values/do-something-when-a-value-changes.md) ·
[Error pages](../pages/show-a-page-when-something-fails.md)

## `log.records` is a channel

```ts shared
type LogRecord = {
    time: string
    level: 'debug' | 'info' | 'warning' | 'error'
    namespace: string
    message: string
    trace: string
}
```

`log.records` is a channel — an ordinary `reactive` of `LogRecord` declaring `history` (28.1) —
which is why an admin page showing the last hundred lines **subscribes** rather than polls. There
is no second mechanism for reading logs back.

The channel's `history` is `ABIDE_MAX_LOG_BUFFER_COUNT`, and it is a memory ring like any other —
bounded, and gone when the process is. Anything that has to outlive the process goes to a
collector, which is what the machine format is for.

`ABIDE_LOGS` opts in to declaring the `GET` over `log.records`. It is off by default because an
app's log is not something to expose by accident. A client reading that `GET` is subscribed to
every line it publishes (18.17), and `abide logs` is exactly that subscription (38.10).

Read on: [Channels](../values/let-anything-publish-and-anything-read.md) ·
[History](../values/keep-the-last-few-values.md)

## Two formats, chosen for the reader

`ABIDE_LOG_FORMAT` picks `tsv` or `json` for a collector; unset, the output is the readable form
for a terminal. `NO_COLOR` refuses ansi anywhere and `FORCE_COLOR` asks for the readable form
off a pipe — the two conventions a terminal tool is expected to honour, and honouring them is
cheaper than explaining why it does not.

Read on: [Tail a deployed app](../ship/watch-a-running-app.md) ·
[Configuration](../reference/configuration.md)

## Next

* [Tracing](follow-a-request-across-services.md) — the id every one of these carries
* [Tail a deployed app](../ship/watch-a-running-app.md) — reading them from a terminal
* [Helpers](../reference/helpers.md) — `log` beside `csp`, `url` and `navigate`
