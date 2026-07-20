# abide — Identity & Auth (Spec, Slice 4)

Status: draft, derived from design interview 2026-07-17.
Scope: the identity/auth model assumed by all prior specs (§13.4, C6-nav, S4). abide provides
the **mechanism; the application owns all policy.** In particular, **abide does not do
authorization** — it plumbs identity and hands you a middleware seam; deciding who may do what
is your code.

> **LOUD NOTE: `clients` controls reachability, NOT authorization.** Which surfaces an RPC is
> reachable from (`clients.*`) is curation, not an access-control gate. **Auth is your
> middleware** — write it. (`ABIDE_APP_TOKEN` is a single-env-var convenience gate for the
> single-tenant case; anything finer is middleware.)

Through-line: abide does the security-sensitive *mechanical* parts (cookie sealing,
constant-time token check, identity plumbing, the middleware seam) and **none of the policy**
(who exists, what credentials are valid, what's authorized). Posture (B) from the interview:
seam + built-in app-token convenience gate + auto-managed identity cookie — **not** a
batteries-included users/sessions/OAuth system (rejected as huge, opinionated, ceremony-in-
the-framework), and **not** an authorization engine.

---

## AU1. Posture & division of responsibility

- **abide owns:** the identity seam, the `ABIDE_APP_TOKEN` machine convenience gate, the auto-
  managed encrypted `abide-identity` cookie, and the `app.ts` **middleware seam** (the place
  your policy runs — abide runs the chain, not the policy).
- **The app owns:** credential verification (password/OTP/OAuth callback — *your* code,
  `Bun.password` available), the user store, and **all authorization policy** (expressed as
  middleware, AU7).
- **No** user tables, OAuth providers, login UI, **or authorization** in core.

## AU2. Accessors — imported ambient (no implicit globals)

All request-scope accessors are **ambient but must be imported** (the rule is "no magic
globals," not "no ambient"). Consistent with CLAUDE.md `request()`/`cookies()`/`server()`.

| Import | Is |
| --- | --- |
| `abide/server/request` → `request()` | the `Request` |
| `abide/server/cookies` → `cookies()` | `Bun.CookieMap` — cookie read/write (cross-request persistence) |
| `abide/server/identity` → `identity()` | the current principal (see AU3) |
| `abide/server/context` → `context()` | generic mutable **per-request** carrier (see AU4) |
| `abide/server/server` → `server()` | the `Bun.serve` instance |

**Handler signature stays `fn(args)`** (§13.2 — one machine-mapped data object). Request
scope is reached via these imported accessors, **not** a second `ctx` param. (The `ctx`-as-
second-param idea from the interview was rejected in favor of imported ambient accessors.)

## AU3. `identity` — the transport-independent principal

1. **Identity always exists — `identity()` is never null.** A brand-new visitor gets an
   **anonymous identity** with an abide-generated stable id, auto-tracked via the
   `abide-identity` cookie. So per-visitor state / rate-limiting / carts work with **zero
   config, no secret, no login.**
2. **Transport-independent — the unified authz principal.** Resolved from whichever source
   authenticated: browser `abide-identity` cookie, machine bearer, or the `ABIDE_APP_TOKEN`
   gate. This is why identity is **not** "a property of session" — a machine caller has an
   identity with no cookie at all.
3. **Read / write:**
   - `identity()` — read the principal.
   - `identity.set(principal)` — **authenticate**: upgrade the anonymous identity to `principal`;
     abide encrypts it into the `abide-identity` cookie automatically.
   - `identity.clear()` — **logout**: revert to a fresh anonymous identity / clear the cookie.
4. **Anonymous vs authenticated signal (FLAGGED default):** `identity()` always returns at
   least `{ id }`. Recommended default to distinguish: an **`authenticated: boolean`** field
   (false for the auto anonymous identity, true after `identity.set()`). Alternative
   considered: infer from presence of app-set fields. Default = explicit `authenticated`
   flag; override if you prefer inference.
5. **`identity` is what goes in the cookie → bounded by ~4KB.** `identity.set()` **throws at
   set-time** if the encrypted payload exceeds the cookie budget. This *structurally*
   enforces "keep it small" — not a convention.
6. **With encryption (AU5), `identity` may be the whole (reasonably-sized) user**, not just an
   id. `context()` (AU4) is then only for genuinely per-request *computed/ephemeral* data,
   not a mandatory place to reload the user. If a user record exceeds ~4KB, fall back to
   `identity = { id }` + load the rest into `context()`.

## AU4. `context()` — generic per-request carrier

- A **mutable bag the author threads data through the request chain** (middleware → handler →
  render), **request-scoped, dies with the request.** (What "session" was wrongly fused with;
  Express's `res.locals`.)
- Not persisted, not a cookie, not auth. Typical use: an early middleware loads derived/
  expensive data once (e.g. a permission set, a tenant record) and stashes it for handlers to
  read.

## AU5. The `abide-identity` cookie

1. **Auto-managed, encrypted by default.** abide serializes `identity` into an **encrypted**
   (AES via Bun/WebCrypto) httpOnly cookie. Encryption chosen over signed-but-readable so the
   cookie is **opaque to the client** (no leaking internal/sensitive fields) — this is what
   makes AU3.6 "identity can be the whole user" safe. Encryption CPU cost is negligible
   (microseconds/request). **No user-facing cookie/session-signing API exists** — it's fully
   internal.
2. **Encryption buys secrecy, not capacity.** The ~4KB cookie ceiling (AU3.5) still applies;
   encryption does not raise it.
3. **`ABIDE_IDENTITY_SECRET` handling:**
   - **Not required for anonymous tracking** — abide uses an auto/ephemeral key. Fine for
     simple/dev cases (not restart-stable, not multi-instance-stable).
   - **Required for *secure authenticated* identity in prod — FAILS FAST if missing.** In prod,
     `identity.set()` of an **authenticated** principal without `ABIDE_IDENTITY_SECRET`
     **refuses** (throws / boot-refuses), matching CO1's fail-fast for required config — no
     fail-open forgeable authenticated identity that resets each boot. Anonymous tracking may
     still use the ephemeral key (non-security-critical).
   - Named around **identity, not "session"** (the conflated term is retired).
4. **TTL — 30 days rolling by default (FD4).** The `abide-identity` cookie expires 30 days after
   last activity (rolling — refreshed on each request), configurable via `ABIDE_IDENTITY_TTL`
   (**milliseconds**). The same TTL applies to per-user sealed tokens (AU9).

## AU6. Machine surfaces (`ABIDE_APP_TOKEN` gate)

1. **Built-in bearer gate (a convenience, not authorization).** With `ABIDE_APP_TOKEN` set,
   remote CLI / desktop bundle / MCP send `Authorization: Bearer <token>` (they read
   `ABIDE_APP_TOKEN` client-side, CLAUDE.md). abide verifies it **constant-time** during
   identity resolution and resolves `identity()` to a built-in **app-owner principal**. For a
   single-tenant tool this is the **entire auth story — one env var, no code.**
2. **All-or-nothing convenience gate — not an authorization model.** When `ABIDE_APP_TOKEN` is
   set, machine-surface requests lacking the correct bearer are rejected; when unset, they
   resolve to anonymous. That is the *whole* built-in gate — a single-tenant convenience,
   **not** a "closed by default" posture with per-RPC public opt-outs (that two-dials model is
   **retracted**, DX8). `clients.*` is reachability/curation, **never** access control. For
   anything finer than the app-token gate — per-user, per-role, per-endpoint — **write
   middleware** (AU7); that is where authorization lives.
3. **Machine identity is stateless.** Bearer/app-token resolves `identity()` per request and
   **never writes an `abide-identity` cookie**; `identity.set()` on a machine-surface request
   is a cookie no-op (identity is request-scoped there). (S4.4 confirmed.)
4. **Two token models (per `machine-surfaces.md` MS5):** `ABIDE_APP_TOKEN` (single shared
   secret) for the **single-tenant app-owner** case; **per-user bearer tokens** for the
   **multi-user** case — issued at CLI download (MS3.5), bound to `identity()`, verified during
   identity resolution to that user's identity. So `ABIDE_APP_TOKEN` is no longer necessarily a
   lone static secret. Issuance/rotation/expiry/revocation mechanism is parked (MS5).

## AU7. Enforcement — authorization is your middleware

- **The `app.ts` middleware chain is where authorization happens (FD1).** `app.ts` exports
  `export const middleware = [(next) => Response, …]` — an **onion** of `(next) => Response`
  functions, onion-composed (global wraps per-RPC wraps handler). It runs on **every server-
  touching request except static assets**. `next()` takes **no args** (reach the request via
  `request()`); **return a `Response` (e.g. `error(403)` / `redirect`) to short-circuit**, or
  `return next()` to pass through. A middleware reads `identity()` and the isomorphic
  `route()` → `{ kind, name, params }` (DX6/FD2 — there is **no** `ctx` object; the former
  `ctx.kind`/`ctx.name`/`ctx.params` are `route()` fields derived from the request URL; for
  `rpc` kind, `params` is the args object). **Auth is just middleware** — a guard is a
  middleware that returns `error(403)` instead of calling `next` (the former `auth:` RPC
  property is retired, FD1).
- **Per-RPC middleware** uses the same shape: `POST(fn, { middleware: [(next) => …] })`. Global
  middleware wraps per-RPC middleware wraps the handler.
- **Uniform across surfaces (§13.4):** RPC, nav, socket-connect, and HTTP-face socket ops all
  pass the same chain. `clients.*` is **reachability/curation, not access control** — an
  unauthorized call must **fail your authz middleware**, not merely be hidden. abide authorizes
  nothing for you; **if you write no middleware, everything reachable is callable.**
- **Socket transport nuance (S4.4):** WS runs the middleware chain only at `socket-connect`;
  in-connection publish/subscribe are authorized in-connection (publish → handler, subscribe →
  connect-auth). HTTP-face socket ops run the chain per request.

### End-to-end flows

**Personal CLI/MCP/desktop tool:** set `ABIDE_APP_TOKEN`. Done — the convenience gate is your
whole auth story, zero auth code.

**Anonymous browser tracking:** nothing — `identity()` already returns a stable auto
anonymous id; stash per-visitor data keyed by `identity().id`.

**Multi-user web app:**
```ts
// login RPC — YOUR credential check, then:
if (await Bun.password.verify(pw, user.hash)) identity.set({ id: user.id, roles: user.roles, authenticated: true })
// app.ts — authorization IS middleware (no ctx; read route() + identity()):
export const middleware = [
  async (next) => {
    if (route().name === 'deleteUser' && !identity().roles?.includes('admin')) return error(403)
    return next()
  },
]
// logout RPC:
identity.clear()
```
abide owns: identity seam, encrypted `abide-identity` cookie, app-token convenience gate, the
middleware seam. You own: credential check, user store, **and every authorization rule** (as
middleware). Set `ABIDE_IDENTITY_SECRET` in prod.

## AU8. CSRF — layered, automatic, tokenless

The `abide-identity` cookie rides every same-origin request automatically, so cookie-
authenticated **mutations** are a CSRF surface. Defense is fully automatic (no tokens, no
user code), exploiting abide's fetch-based RPC model:

1. **`abide-identity` = `SameSite=Lax` + `httpOnly` + `Secure`(prod).** `Lax` blocks the
   cookie on cross-site POST/subresource requests. Safe because **mutations are never on GET**
   (§14.1) — the top-level GET that `Lax` still allows can't mutate. (`Strict` rejected: it
   also drops the cookie on inbound top-level nav from other sites, breaking "click a link,
   stay logged in.")
2. **Mutations require the abide client's non-simple request shape** (custom header / non-
   simple `Content-Type`), which the client proxy always sends. A cross-site `<form>` **cannot**
   set those; a cross-site `fetch` that tries triggers a **CORS preflight** that fails under
   the crossOrigin-closed default (§14.3). The server **rejects mutations lacking the shape.**
3. **Origin/Referer verified against `APP_URL` on mutations** — defense-in-depth for SameSite
   edge cases / older browsers.
4. **No CSRF tokens** — 1+2+3 fully cover a same-origin fetch app with an abide-controlled
   client; tokens would add ceremony for nothing.
5. **`crossOrigin` opt-in (§14.3) shifts responsibility to the declared allowlist** — a
   deliberately-CORS-opened RPC is the user's call; abide still enforces the allowlist.

**App forms work** because abide forms submit through the proxy (`<form onsubmit={handler}>`
→ `preventDefault()` + RPC call → has the non-simple shape). The **only** blocked path is a
**native no-JS/pre-hydration `<form action>` POST** — which is both the attack shape and the
progressive-enhancement shape. **Posture (A): JS-first** — abide already requires JS for its
reactive model, so native RPC form posts are not a CSRF-exempt path; a form submitted before
hydration falls through to a rejected native POST (acceptable — the UI isn't interactive pre-
hydration). Progressive-enhancement double-submit tokens are **parked**.

### CSWSH — the WebSocket vector (what the custom-header defense can't touch)

A WS handshake can be opened cross-origin, **sends the cookie**, is **not subject to CORS**,
has **inconsistent SameSite**, and **cannot carry custom headers** — so CX-2 defenses (1,2)
don't apply. Therefore:

1. **Mandatory automatic `Origin` check at `socket-connect`.** The browser always sends an
   unforgeable `Origin` on a WS handshake; abide **rejects any upgrade whose `Origin` ≠
   `APP_URL`** before establishing the connection. Automatic, not user code.
2. **Cookie-auth WS requires a matching `Origin`; token-auth WS does not.** Non-browser
   clients send no `Origin` and authenticate via bearer/app-token (nothing ambient to hijack).
   Rule: a cookie-authenticated WS **demands** a valid same-origin `Origin`; a bearer/app-token
   WS is gated by the token and needs no `Origin`.
3. **`crossOrigin` socket opt-in** (parallel to §14.3): default closed; cross-origin socket
   access requires a declared allowlist and the user owns the risk.
4. **HTTP-face asymmetry:** POST-publish is a mutation → full CX8.1–3 protection. **SSE
   subscribe (GET) is protected for free by CORS** — unlike WS, `EventSource` *is* subject to
   CORS, so a cross-site subscribe without CORS headers is browser-blocked under crossOrigin-
   closed. (This is exactly why WS needs a special Origin check and SSE doesn't.)

## AU9. Per-user tokens — sealed identity over bearer (unified with the cookie)

Per-user CLI provisioning (MS3.5) requires per-user bearer tokens. The model collapses
token-auth and cookie-auth into **one mechanism**:

1. **A per-user token *is* a sealed identity blob — the same seal as the `abide-identity`
   cookie, carried in `Authorization: Bearer <blob>` instead of a cookie.** Cookie-auth and
   token-auth differ only by **transport**; both are "an encrypted identity," verified by one
   path — **unseal → `identity()`**. Issuance = seal the current `identity()` (with expiry) and
   hand it over at CLI download.
2. **One seal secret:** `ABIDE_IDENTITY_SECRET` seals both cookie and token. No separate token
   key.
3. **Mandatory expiry (`exp`).** Sealed tokens carry an expiration; unseal rejects expired
   tokens. **Default TTL = 30 days, rolling** (refreshed on activity), configurable via
   `ABIDE_IDENTITY_TTL` (**ms**) — the same TTL as the `abide-identity` cookie (AU5.4, FD4).
4. **Bearer ladder (built-in identity resolution, before your middleware runs):**
   - bearer == `ABIDE_APP_TOKEN` (constant-time) → **app-owner** identity (static single-tenant
     secret — "knows the secret," *not* a sealed identity);
   - else unseal bearer as a sealed identity → **that user's** identity;
   - else → **reject** when `ABIDE_APP_TOKEN` is set (the single-tenant convenience gate,
     AU6.2), otherwise a **fresh, untracked anonymous identity** (no cookie to persist on a
     machine surface). This resolves *who the caller is*; **whether they may proceed is your
     middleware** (AU7), not a per-surface abide default.
5. **Anonymous is a real identity object, not null** (AU3.1). "New user" = `{ id, authenticated:
   false }`. Browser anonymous is persisted (auto cookie); machine anonymous is fresh per
   request (or rejected under the gate).
6. **Revocation — expiry + nuclear only (no denylist):**
   - **default:** expiry-based — TTL lapses; re-download to refresh. No per-token revocation.
   - **nuclear:** rotate `ABIDE_IDENTITY_SECRET` → invalidates **all** tokens **and** cookies at
     once (logs everyone out everywhere).
   - **No `appDataDir` denylist** — deliberately dropped for simplicity; there is no individual-
     token revocation.

---

## Deferred / parked (rule before implementation)

- **`canSubscribe` per-socket gate** (S4) — how it reads `identity()`; still parked.
- **Horizontal/multi-instance identity** — the ephemeral-key fallback isn't multi-instance-
  stable; a shared `ABIDE_IDENTITY_SECRET` fixes the cookie, but any server-side per-visitor
  state store is out of core (same seam question as the socket backplane, S3.3).
- **Progressive-enhancement CSRF tokens** (double-submit) — only if posture (B) no-JS forms
  are ever adopted (AU8); JS-first (A) needs none.
- **`Bun.password` hashing helper** exposure — available to the app; abide doesn't wrap it.
