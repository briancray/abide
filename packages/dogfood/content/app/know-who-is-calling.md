---
title: Know who is calling
nav: Auth & principal
intent: Sign a caller in, read who they are anywhere, and sign them out.
covers:
  - `principal.authenticated`
  - `principal.expiresAt`
  - `principal.error`
  - `principal.resolved`
  - `principal.caller`
  - `principal.set`
  - `principal.clear`
  - `Principal`
  - `onPrincipal`
  - `authenticated`
  - `expiresAt`
  - `error`
  - `cookies`
  - `ABIDE_PRINCIPAL_SECRET`
  - `ABIDE_PRINCIPAL_TTL`
examples:
  - packages/dogfood/examples/principal-session
---

abide does not know how you authenticate somebody. It knows what to do **after** you have: seal
the claims into a cookie, resolve them into whatever your app calls a user, and make that
readable by name on both sides without anything being passed down.

## One seal, read everywhere

{% example principal-session %}

*1 ambient read, 0 wires* — the arm holds the seal and the resolved claims as two variables
and a reader list, because the header the form never names has to be told.

`principal.set(claims)` authenticates this caller: the claims are sealed with
`ABIDE_PRINCIPAL_SECRET` into an `HttpOnly` cookie living `ABIDE_PRINCIPAL_TTL`, and
`principal.clear()` signs them out. What you put in is yours — an id, a tenant, a role — and
abide's part is that it comes back unforged.

## The five reads

| | |
| --- | --- |
| `principal.authenticated` | whether this caller presented something the server accepted |
| `principal.resolved` | what `onPrincipal` returned, merged over the baseline |
| `principal.expiresAt` | when the seal lapses |
| `principal.error` | the app's resolver having failed |
| `principal.caller` | **which browser**, as against who they are |

Each is a `Reactive`, so reading one in a template subscribes and a sign-out moves every place
that reads it. Each is request-local on a server, so a handler reads the principal of the
request that reached it.

`principal.caller` is the one worth pausing on. It identifies a **browser**, not a person, and
it is there whether or not anybody has signed in — which is what a rate limiter, a per-device
preference and a cache key want. Reaching for it as an identity is the mistake it is named to
prevent.

## `onPrincipal` turns claims into your app's user

```ts #server/app.ts — excerpt
import { onPrincipal } from 'abide'

onPrincipal(async (claims) => {
    const user = await database.users.find(claims.id)
    return { name: user.name, role: user.role }
})
```

What it returns is merged over the baseline and read as `principal.resolved`. So the cookie
stays small — an id — and the page still reads a name, because the resolution happens on the
server where the record is.

A resolver that fails fills `principal.error` rather than throwing out of every read. A caller
whose seal is valid and whose *record* could not be loaded is a distinguishable state, and it
is one an app usually wants to render rather than escalate.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Lifecycle](run-code-at-start-and-stop.md)

## `Principal` is the wire document

```ts shared
type Principal = { authenticated, expiresAt?, error?, …claims }
```

`authenticated`, `expiresAt` and `error` are abide's three fields, and everything else in the
document is yours. It is what the browser is served, which is what makes the same reads work
there — a page rendered on the server and hydrated in a browser reads `principal.resolved.name`
in both, and neither branches on where it is.

## `cookies` is the seam underneath

`cookies()` reads and writes the request's cookies, and the principal cookie is one it manages.
Reaching for it directly is for the cookies that are yours — a theme, a consent flag, a
last-viewed id.

The principal cookie is `HttpOnly`, so script cannot read it. That is the point: the claims
reach the page through the `Principal` document the server rendered, and the *seal* never
leaves the header.

Read on: [Authorization](../server/decide-who-may-call-what.md) ·
[Config](configure-the-app.md)

## Next

* [Authorization](../server/decide-who-may-call-what.md) — deciding what a caller may do
* [Config](configure-the-app.md) — where the secret and the TTL are read
* [Ambient values](../reference/ambient-values.md) — `principal` beside the rest
