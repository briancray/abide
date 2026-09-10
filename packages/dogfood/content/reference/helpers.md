---
title: Helpers
nav: Helpers
intent: log, csp, url, navigate.
enumerates:
  - log
  - csp
  - url
  - navigate
---

Four names that are not producers and not transports. `log` records what happened, `csp`
declares what a page may load, `url` builds an address, and `navigate` goes to one.

## `log`

| Name | Signature | Meaning |
| --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message on the default channel. |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | The four levels. |
| `log.channel` | `(name: string) => Logger` | A named channel. |
| `Logger` | `typeof log` | What `log.channel` hands back. |
| `log.enabled` | `() => boolean` | Whether a gated line on this channel would be written. |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; channel: string; message: string; trace: string }` | One line, as a value. |
| `log.records` | `Room<LogRecord>` | The room every line is published to. |
| `abide:request` | `debug` | One line per request. |
| `abide:socket` | `debug` | One line per socket event. |
| `abide:lifecycle` | `debug` `error` | A lifecycle that ran. |
| `abide:principal` | `debug` `warning` | A principal set or cleared. |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object. |
| `abide:mcp` | `debug` `warning` | A handler withheld from MCP, or a tool published with no description. |
| `abide:openapi` | `warning` | A handler whose schema had no JSON Schema export. |
| `abide:config` | `warning` | A second `onConfig` replacing the first. |
| `abide:render` | `warning` | An `error.abide` that itself failed. |
| `abide:refuse` | `warning` | A message formatter that threw. |
| `abide:reactive` | `warning` | A failed revalidation over a value still being served. |
| `abide:watch` | `warning` | A `watch` effect or `Disposer` that threw. |
| `abide:hydrate` / `abide:navigate` | `warning` | The browser lane. |

`log` is a **channel** underneath, which is what makes its records readable the way any room is
readable: `log.records` is a cursor, so a page showing the last hundred lines subscribes rather
than polls, and `abide logs` is `abide call` on that same handler.

### Channels and gating

A record carries a channel, defaulting to `APP_NAME`. `DEBUG` gates which channels emit, with
the same comma-and-wildcard grammar the ecosystem already uses — so a channel nothing selects
costs the argument evaluation and nothing else.

### The two formats

The readable form is for a terminal and the machine form is for a collector, chosen by
`ABIDE_LOG_FORMAT`. `NO_COLOR` refuses ansi anywhere and `FORCE_COLOR` asks for the readable
form off a pipe, which are the two conventions a terminal tool is expected to honour.

## `csp`

| Name | Signature | Meaning |
| --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => Middleware` | The rung that sets `content-security-policy`. |
| `csp.nonce` | `() => string` | This response's nonce, for the app's own inline script. |

`csp()` is a middleware rung, registered in `app.ts` like any other. It emits a policy that
already knows what the build produced — the bundle's own chunks, the styles a component
adopted — so the common case needs no directive written by hand.

## `url`

| Name | Signature | Meaning |
| --- | --- | --- |
| `url` | `<P extends string>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query] : [params?: ParamsOf<P>, queryParams?: Query]) => string` | Builds an address from a route literal. |
| `HasParams<P>` | `boolean` | Whether the literal carries a required segment. |
| `HasSegments<P>` | `boolean` | Whether the literal carries a segment of any kind. |
| `RequiredNames<P>` | `string` | The required segment names. |
| `OptionalNames<P>` | `string` | The optional segment names. |
| `RestNames<P>` | `string` | The rest segment names. |
| `Query` | `Record<string, unknown> \| URLSearchParams` | The query half. |
| `ParamsOf<P>` | `& { [K in RequiredNames<P>]: string \| number } & { [K in OptionalNames<P>]?: string \| number } & { [K in RestNames<P>]?: string \| number \| (string \| number)[] }` | What a route literal's segments accept. |

### Parameters

* `pattern` — a **route literal**, not an address. The literal decides whether a params
  argument is required, optional or absent.
* `params` — required where the literal carries a required segment. An omitted optional key
  omits its segment rather than leaving a hole.
* `query` (optional) — a `Query`, and it is **last**, always.

### Return value

A mount-relative address, resolved at read time — against `<meta name="abide-mount">` in a
browser and against `config().APP_URL` on a server. That is what lets one build serve at the
root and under a sub-path.

## `navigate`

| Name | Signature | Meaning |
| --- | --- | --- |
| `navigate` | `(url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }) => Promise<void>` | Navigates. |

It navigates and does **not reload the document**, so layouts stay, loaded values stay loaded,
and the head's keyed contributions are replaced rather than rebuilt. An ordinary `<a href>` does
the same thing; `navigate` is for the case where the decision is made in code.

## Examples

### A log line with structure

```ts server
log.info('invoice paid', { id: '4310', cents: 124000 })
```

### A policy in `app.ts`

```ts #server/app.ts — excerpt
import { csp, middleware } from 'abide'

middleware(csp({ 'img-src': ["'self'", 'https://cdn.example'] }))
```

### An address built from a literal

```abide abide
<a href={url('/invoices/[id]', { id: invoice.id })}>{invoice.reference}</a>
```

## See also

* [Logging](../app/record-what-happened.md) — the guide to `log`
* [CSP](../app/lock-down-what-the-page-may-load.md) — the guide to `csp`
* [Links & navigation](../pages/link-to-another-page.md) — `url` and `navigate` in use
