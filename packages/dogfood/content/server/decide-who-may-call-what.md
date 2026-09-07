---
title: Decide who may call what
nav: Authorization
intent: Put an authorization rung in front of a handler, and have it run before anything parses.
covers:
  - `Middleware`
  - rpc › `middleware`
  - Lifecycle hooks › `middleware`
---

Auth is middleware. Not a decorator, not a config file mapping routes to roles, and not a
check at the top of every handler that one handler will eventually be missing.

A rung sits in front of the operation, decides, and either calls the next one or does not.

```ts #server/rpc/invoices.ts
export const getInvoice = GET(invoiceById, {
    middleware: [
        async (next, ctx) => {
            const { id } = await ctx.args()
            if (!(await mayRead(principal.id, id))) return notYours({ id })
            return next(ctx)
        },
    ],
})
```

*1 file, 0 route tables* — the rung is on the handler it guards, so neither can be moved
without the other.

## `Middleware` is one type, in three lanes

```ts shared
type Middleware<Ctx, Result> = (
    next: (ctx?: Ctx) => Promise<Result>,
    ctx: Ctx,
) => Result | Promise<Result>
```

`next` is the **next rung**, and hands back whatever that rung returns. Where there is no next
rung, `next` runs the operation itself.

| Lane | `Ctx` | Result | Runs |
| --- | --- | --- | --- |
| app | `{ request }` | `Response` | pre-routing, on every request |
| rpc | `{ request, args }` | `Value \| Failures` | on every call to that handler |
| socket | `SocketEvent` | `void` | on subscribe and on publish |

Three lanes, one type. `Ctx` is a record naming what that lane actually **has** — the app lane
runs before the route resolves, so it has a request and no arguments; the rpc lane is typed to
one handler's own arguments.

The **Result** column is the difference that matters. The rpc lane hands back what the handler
would have handed back, not a `Response`, and that lets the same rungs run on an **in-process**
call. A page rendering on the server reads through the handler, so a rung that authorises on an
id in the arguments cannot be reachable by a browser and missed by the render. The app lane
stays `Response`-shaped because pre-routing there is no value yet, which also makes it the lane
where a rung that must set a header belongs.

A rung's refusals join the handler's own in what the caller can narrow, so `getInvoice.isError(
error, 'NotYours')` reaches a name the rung declared and never the handler.

Read on: [Sockets](keep-a-room-of-callers-in-sync.md)

## Refusing is returning without calling `next`

```ts server
async (next, ctx) =>
    (await signedIn(ctx.request)) ? next(ctx) : notSignedIn()
```

One spelling covers all three shapes, because a rung returns what the handler returns:
`return notSignedIn()` refuses, `return cached` answers without running the handler, and
`return next(ctx)` goes on. A `refuse(401)` still works and is a **throw**, `refuse` being
declared `never`.

Two ways out, and they are not the same:

| | Effect |
| --- | --- |
| return without calling `next` | short-circuits — no inner rung runs, no handler runs |
| throw | escapes the **whole** onion rather than unwinding through it |

A rung that wants to observe both — a timer, a log line — calls `next` inside a `try`.

## The app-wide rung goes in `app.ts`

`middleware(...)` registers pre-routing rungs. It is a hook you **call**, so it can be
registered from whatever module owns the thing it is about, and `app.ts` is the right place for
the app-wide ones only because that file always runs at startup:

```ts #server/app.ts
import { csp, middleware } from 'abide'

middleware(csp(), requireSignIn())
```

Rungs compose in registration order. The call hands back the way off again, so a module that is
torn down can remove its own.

Pre-routing means this lane has a request and nothing else. Anything resource-aware —
authorising by an id in the arguments — is necessarily a handler's own rung, which is where
`ctx.args()` exists.

Read on: [Lifecycle](../app/run-code-at-start-and-stop.md) · [CSP](../app/lock-down-what-the-page-may-load.md)

## `ctx.args()` parses lazily, and that orders the checks

A rung that never asks for the arguments pays nothing. The first one that asks triggers the
parse, and what comes back is **parsed, coerced and validated**:

* An unauthenticated caller gets `401` from a rung that never looked at the body — so they
  never read your schema back out of a `422`.
* A rung authorising on a resource id compares a number against a number, whichever method
  carried it. The string/number split by method is the silent one, and an authorisation check
  passing on a type mismatch is the failure it causes.
* A malformed body is `400` and a schema refusal is `422`, both raised where that first rung
  asked.

The result is cached for the request, so asking twice parses once.

Read on: [Schemas](check-what-callers-send-you.md)

## On an rpc route the body belongs to `ctx.args()`

A body reads once. `request().json()` in a rung takes it, and every rung after that one — and
the handler — gets nothing. There is no second way in on this lane, and that is the whole
reason `ctx.args()` exists rather than being a convenience over the request.

Read on: [Request](../app/read-the-incoming-request.md)

## Rungs run from the outside in

```
app middleware -> routing -> rpc middleware -> args parse -> handler
```

Two things sit **outside** the onion on purpose: a `CORS` preflight, which carries no
credentials and so has nothing for a rung to authorise, and `/__abide/health`, for the same
reason.

Read on: [CORS](let-another-origin-call-you.md) · [Health](../app/tell-a-load-balancer-you-are-healthy.md)

## `clients` withholds a surface, never access

`clients` withholds a handler from a **surface** — an OpenAPI listing, an MCP tool list. It is
not access control: the http address answers exactly as it did. Who **may** call is this rung,
the same one that decides it for a browser.

Read on: [Withholding a surface](../machines/keep-a-handler-off-a-surface.md) ·
[Auth & principal](../app/know-who-is-calling.md)

## Next

* [Auth & principal](../app/know-who-is-calling.md) — where `principal` comes from
* [Failures](refuse-a-request-and-say-why.md) — refusing with a name and data instead of a status
* [Schemas](check-what-callers-send-you.md) — what `ctx.args()` hands a rung
