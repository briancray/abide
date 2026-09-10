---
title: Ambient values
nav: Ambient values
intent: request, route, cookies, principal, config, trace, health and the rest.
enumerates:
  - request
  - response
  - cookies
  - route
  - online
  - principal
  - config
  - trace
  - server
  - health
---

An **ambient value** is one nothing hands you. `route.params`, `principal.authenticated` and
`config()` are in scope wherever they make sense, so a layout reads the current route without a
page passing it down and a rung reads the caller without a context object being threaded
through.

Most of them are `Reactive`, which is what makes them readable by name and reactive to read —
`{online}` in a template mounts and unmounts a banner with no listener attached.

## Scope, not globals

An ambient is **request-local on a server** and process-wide in a browser. That is the whole of
what keeps two callers apart: `principal` inside a handler is the principal of the request that
reached it, and there is no moment at which one request's is visible to another's.

## `request`

| Name | Signature | Meaning |
| --- | --- | --- |
| `request` | `() => Request` | The request being served. |

## `response`

| Name | Signature | Meaning |
| --- | --- | --- |
| `response` | `() => { status: number; headers: Headers }` | The response being built for the request being served. |

## `cookies`

| Name | Signature | Meaning |
| --- | --- | --- |
| `cookies` | `() => CookieMap` | The cookies of the request being served, live and mutable. |

## `route`

| Name | Signature | Meaning |
| --- | --- | --- |
| `route.url` | `Reactive<URL>` | Where we are. |
| `route.params` | `Reactive<Params>` | The matched route's segments. |
| `Params` | `Record<string, string>` | What a matched route's segments are. |
| `route.name` | `Reactive<string>` | The resolution path. |
| `route.navigating` | `Reactive<boolean>` | Whether a navigation is in flight. |

## `online`

| Name | Signature | Meaning |
| --- | --- | --- |
| `online` | `Reactive<boolean>` | Whether the caller can reach the app. |

## `principal`

| Name | Signature | Meaning |
| --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses. |
| `principal.error` | `Reactive<Failed<string, unknown> \| undefined>` | The app's resolver having failed. |
| `principal.resolved` | `Reactive<unknown>` | What `onPrincipal` returned, merged over the baseline. |
| `principal.caller` | `Reactive<string>` | Which browser, as against who they are. |
| `principal.set` | `(claims: unknown) => Promise<void>` | Authenticates this caller. |
| `principal.clear` | `() => void` | Signs this caller out. |
| `Principal` | `{ authenticated, expiresAt?, error?, …claims }` | The wire document. |
| `authenticated` | `boolean` | Whether this caller presented a seal the server accepted. |
| `expiresAt` | `string \| undefined` | When the seal lapses. |
| `error` | `Failed<string, unknown> \| undefined` | The app's resolver having failed. |

## `config`

| Name | Signature | Meaning |
| --- | --- | --- |
| `config` | `Reactive<Config>` | The resolved configuration document. |
| `Config` | `interface Config { …Env }` | Every field of `Env`, plus what `onConfig` defaulted and the schema normalised. |
| `Env` | `Record<string, string \| undefined>` | The process environment as read, before coercion. |
| `config.invalidate` | `() => void` | Re-reads the environment and re-runs `onConfig`. |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's defaults and its schema. |
| `ConfigDefaults` | `(env: Env) => unknown` | The defaults function, synchronous by contract. |
| `schema` | `Schema<Config>` | The gate over the whole configuration document. |

## `trace`

| Name | Signature | Meaning |
| --- | --- | --- |
| `trace` | `() => string` | The trace id of the operation this work belongs to. |
| `trace.sampled` | `() => boolean` | The caller's sampling decision, carried through verbatim. |
| `trace.span` | `<T>(name: string, body: () => T) => T` | Opens a child span around a body. |
| `trace.headers` | `() => Record<string, string>` | What an outbound request carries. |

## `server`

| Name | Signature | Meaning |
| --- | --- | --- |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The listening server. |

## `health`

| Name | Signature | Meaning |
| --- | --- | --- |
| `health` | `Reactive<Health>` | The account of the app this call is in. |
| `Health` | `{ version: string; abide: string; startedAt: string }` | The account itself. |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's reporter, merged over the baseline. |
| `version` | `string` | The app's version. |
| `abide` | `string` | The framework's version. |
| `startedAt` | `string` | When the process started, ISO-8601. |


## Description

### Isomorphism is per value, not per name

Each of these answers from what the side it is on actually has, and the table on its own page
says how. `online` is `navigator.onLine` and its events in a browser and `true` on a server, a
caller being served having reached the app. `request` exists only where a request does.

That is not a shim: a name means the same **question** on both sides and is answered from
different evidence, which is why a page rendered on the server and hydrated in a browser can
read one without branching on where it is.

### Reading one subscribes

An ambient that is a `Reactive` is read the way any value is read, so reading it in a template
subscribes and reading it in a handler does not. Nothing about it being ambient changes the
tracking rules.

## Examples

### The caller, in a rung

```ts #server/rpc/invoices.ts — excerpt
export const getInvoice = GET(invoiceById, {
    middleware: [
        (next, ctx) => {
            if (!principal.authenticated) return refuse(401)
            return next(ctx)
        },
    ],
})
```

### The route, in a layout

```abide #ui/pages/layout.abide — excerpt
<nav aria-busy={route.navigating}>
    <a href="/invoices"
        aria-current={route.name.startsWith('invoices')}>Invoices</a>
</nav>
```

### Telling a reader the connection went

```abide abide
{#if !online}
    <p role="status">You are offline. Nothing is being saved.</p>
{/if}
```

## See also

* [Auth & principal](../app/know-who-is-calling.md) — the guide to `principal`
* [Config](../app/configure-the-app.md) — the guide to `config`
* [Offline](../app/know-when-the-browser-goes-offline.md) — the guide to `online`
