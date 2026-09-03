---
title: Let another origin call you
nav: CORS
intent: Open one handler to a named origin without opening the app.
covers:
  - rpc › `crossOrigin`
  - `vary`
  - `referrer-policy: strict-origin-when-cross-origin`
---

A partner's dashboard needs one endpoint of yours. The usual answer is a CORS layer in front of
the whole app and a list of paths beside it, which is a second place to be wrong about which
handler is public.

Declare it on the handler:

```ts #server/rpc/status.ts
export const serviceStatus = GET(() => ({ up: true, since: startedAt }), {
    crossOrigin: ['https://partner.example'],
})
```

*1 line, 0 proxy config* — every other address in the app stays closed.

## `crossOrigin` is per handler, and closed by default

| Value | Means |
| --- | --- |
| absent | same-origin only — the default |
| `true` | any origin |
| `string[]` | exactly these origins |

`true` is worth saying out loud rather than reaching for: an address that any origin may call
is an address any page a caller visits may call **with that caller's cookies**, so it belongs on
answers that do not depend on who asked.

## abide answers the preflight itself

A cross-origin JSON `POST` always sends `OPTIONS` first, so an allow-list with nothing answering
it is an allow-list that never works. Where `crossOrigin` is declared, abide answers:

| Header | Value |
| --- | --- |
| `access-control-allow-origin` | echoed from the allow-list, or the request's own where `crossOrigin` is `true` |
| `access-control-allow-methods` | this handler's method |
| `access-control-allow-headers` | echoed from `access-control-request-headers` |
| `access-control-allow-credentials` | `true` |
| `access-control-max-age` | how long the browser may cache the answer |
| `vary` | `origin, access-control-request-headers` |

The preflight is answered **outside** middleware, for the same reason `/__abide/health` is: it
carries no credentials, so there is nothing for a rung to authorise.

An address with no `crossOrigin` answers `OPTIONS` with `404`, the same as any other unmounted
method.

Read on: [Authorization](decide-who-may-call-what.md)

## `crossOrigin` replaces a mutation's origin gate

`crossOrigin` on a mutation **replaces** the same-origin `Origin` comparison for that handler
rather than sitting beside it. Without one, a `POST` whose `Origin` does not match `APP_URL`'s
is `403` before the handler runs.

So opening a mutation cross-origin is one decision spelled once, not a CORS allow-list and a
CSRF exemption that have to agree.

Read on: [Mutations](change-something-on-the-server.md)

## `vary` tells a cache what the answer depended on

abide emits it wherever an answer depends on a request header:

| `vary` | On |
| --- | --- |
| `origin` | a cross-origin rpc — a shared cache must not serve one origin's answer to another |
| `accept` | a stream that can be framed as jsonl or as SSE |
| `accept-encoding` | anything compressed or compressible |

Nothing abide serves ever varies on `traceparent`, which keeps a seeded answer landing
in the browser cache under its plain URL.

Read on: [Streaming data](send-data-as-it-arrives.md)

## A page sends a trimmed referrer cross-origin

A page carries `referrer-policy: strict-origin-when-cross-origin` — the browsers' own default,
written down. It is there for the older agent that still defaults to
`no-referrer-when-downgrade` and leaks an authenticated path to every cross-origin image on the
page.

Read on: [CSP](../app/lock-down-what-the-page-may-load.md)

## A socket's `crossOrigin` gates the upgrade

`crossOrigin` on a `socket` is the same option deciding who may **upgrade**, closed unless
declared. Undeclared, the check compares against `APP_URL`'s origin — and where `APP_URL` is
unset it falls back to the request's own, which is the weaker answer: a caller controls its own
`Host`, and behind TLS termination that origin is the proxy's.

Read on: [Sockets](keep-a-room-of-callers-in-sync.md) · [Config](../app/configure-the-app.md)

## Next

* [Authorization](decide-who-may-call-what.md) — who may call, as against which origin may ask
* [Limits](put-a-ceiling-on-a-request.md) — a ceiling on what an opened address will accept
* [Mutations](change-something-on-the-server.md) — the origin gate a write gets by default
