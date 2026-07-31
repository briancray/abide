# abide — `.abide` Template Compiler (Spec, Slice 2)

Status: draft, derived from design interview 2026-07-17.
Scope: the `.abide` template compiler and its runtime. Builds directly on the RPC / read
core (`docs/spec/rpc-core.md`); section refs like §7 point there, C-refs point here.

Through-line: `.abide` is a **Svelte-family AOT compiler over the §7 fine-grained `state`
substrate** (the atom was called `signal` until ADR 0023 retired the name). There is no VDOM and no runtime template interpreter. Components are
structured collections of §7 effects. The server render path (→ HTML) and the client
attach path (→ hydrate) are each **single paths reused for first load and every
navigation**.

---

## C1. Compilation model

1. **No-VDOM, fine-grained, state-driven.** `{expr}` → text node + effect subscribed to
   the read; on change, write `node.textContent` directly. `{#if}` → mount/unmount a
   subtree. `{#for … by key}` → keyed reconciler over real DOM. No diffing.
2. **One `.abide` file → two compiled outputs**, selected by build (mirrors §6 module-swap):
   - **client module** — DOM-construction + reactive-wiring instructions;
   - **server module** — incremental HTML string/stream producer (out-of-order, §5/§6)
     with the §5 hydration payload woven in.
3. **Components are effect-scopes over the shared substrate (§7)** — no parallel component-
   reactivity system. The instance scope owns its effects and tears them down on unmount
   (same scope that disposes §12.5 stream subs and §7.4 `watch`).
4. **AOT only.** The compiler runs at build / `abide dev` watch. No runtime template
   interpreter ships; no template string is parsed in the browser.

## C2. Hydration

- **Hydrate, not resume.** Resume is rejected: it requires closure serialization that §4's
  codec explicitly excludes, imposes `$`-boundary authoring ceremony, forces §7 to become
  serializable, and fights three stated goals (stack visibility, dev/build consistency,
  small-API). Its win is narrow (huge + sparsely-interacted pages) and off abide's app-
  shaped center of gravity; §7 fine-grained hydration + islands already capture most of it.
- **Fine-grained attach, not re-render.** Boot re-runs component setup, rebuilds the §7
  graph, and **attaches to existing server DOM** (claims nodes, adds listeners) — does not
  recreate DOM. Server-fetched values are seeded from the §5 payload (no refetch); pure
  computations may re-run (cheap). **Non-deterministic `state()` initializers**
  (`state(Date.now())`) are **recorded during SSR and replayed on hydration** (§5c) — the
  client seeds the recorded value rather than re-evaluating, so server and client state never
  desync.
- **Automatic static-subtree skipping (islands).** The AOT compiler knows which subtrees
  have reactive bindings/handlers. Genuinely inert leaves compile to HTML the client
  **never touches** (no listeners, no wiring, no setup). The **block boundary is the
  hydration unit** — a conditional/loop block always hydrates; only inert leaves skip.
  Fully automatic, no island grammar.
- **PARKED:** lazy-mount island triggers (`on-visible`/`on-idle`/`on-interaction`) — a
  later escape hatch if page size ever bites; composes with the above, needs no closure
  serialization.

## C3. Async reads in templates (the RPC seam)

1. **`{fn(args)}` = reactive peek** — an effect reading the §7 slot state; renders
   `undefined` while pending, the value when resolved, re-renders on change/invalidate.
   Composes with `?.`, `??`, `{#if}`, `{#switch}`, `{#for}`, attributes (pending = treated
   as `undefined`).
2. **On SSR, peek auto-streams (out-of-order, §5.4/§6).** Rendering triggers the in-proc
   handler (§6.6); SSR emits a placeholder, registers the §7.4 one-shot "resolve → flush
   HTML patch + §5 cache entry," continues siblings. Client seeds cache, never refetches.
3. **`{await fn()}` = block/suspend.** SSR **waits** for the value before emitting that
   subtree (value is in the initial HTML — SEO, no layout shift). On the client it
   **suspends the subtree** to the nearest `{#await}`/`{#try}` boundary. The opt-in for
   "must be in initial HTML."
4. **Three forms:** peek = silent-stream, await = block/suspend, `{#await p}{:then}{:catch}
   {:finally}` = explicit pending branch + `{:then}` narrowing + `{:catch}` over the §9.2
   error slot.
5. **Reads are render-triggered (lazy)** — a `{fn(args)}` inside `{#if false}` never fires;
   matches §7 subscribe-on-read.
6. **`.pending()` / `.error()` probes** are readable in template expressions as reactive
   reads of the slot's derived state (§7.2).

## C4. Components

1. **Reactive destructured props.** `const { name = fallback, ...rest } = props()` —
   reads compile to §7 state reads; parent `name={expr}` change updates the child; defaults
   apply on absent/`undefined`; `...rest` is a reactive collection.
2. **One default slot — `<slot/>`**, and that is its ONLY spelling; **no named slots.** `children` is a
   RESERVED template name — it is what the outlet resolves off the scope (`pushChildrenSlot`) — so a
   FREE `children` in any expression position is a compile error naming `<slot/>`, in one gate both lanes
   ask (`rewriteExpr`, the funnel every interpolation / attribute value / block head passes through).
   Two things this retracts, for the same reason:
   - **`{children()}`** was advertised as an equivalent interpolation form. It was a carve-out from the
     law stated for components one clause down — an interpolation renders TEXT, and an outlet renders a
     SUBTREE, so it is a tag for exactly the reason `{Name(…)}` is not one. `emitCheck` declared a
     `children` intrinsic to make the carve-out type-check, which is the only reason it looked supported.
   - **Fallback via `{#if children}<slot/>{:else}…{/if}`** cannot work and never did. A function is
     always truthy, and a childless caller passes a FUNCTION: the outlet lowers to a component invocation
     of whatever it is handed, so a childless `<Name/>` passes the shared empty children factory
     (`emptyChildren`) rather than nothing. The `{:else}` branch was therefore unreachable on the server,
     and the check lane agreed — it declared the intrinsic `() => unknown`, not optional. Fallback content
     inside `<slot>…</slot>` is parsed and ignored, and is where this belongs if it is built.

   That `emptyChildren` is a contract both lanes now spell, not a default each picked: `serverRuntime`'s
   returns an empty `Raw`, `runtime`'s an empty `Mountable`, one shared instance each (nothing about
   either is per-call). The client used to pass `null`, which reached `$rt.component` as a non-function
   and threw `<children> is not a component in scope` on hydrate for EVERY childless `<slot/>` while the
   server rendered correct HTML — and, because an inline component's adapter installs children as
   `if (typeof $args[1] === "function")`, left `$s.children` unset on an `Object.create($scope)` scope, so
   a childless inline component nested in a component that DID receive children rendered the OUTER ones.
   An output-comparing test cannot see either: only one lane throws, and the other lane's HTML is right.

   The name is reserved in **two** positions, and the second is the one the first exists for. A
   REFERENCE is caught by `rewriteExpr`; a BINDING is caught by `rejectReservedBindings`, a pre-pass over
   the AST driven by `templateChildren.ts`'s `BINDING_SITES` table — the `{#for}` item and index, a
   `{:then}`/`{:catch}` param, and an inline component's params. All of them PUBLISH onto the scope chain
   the outlet reads, so inside that body `<slot/>` resolves to the BINDING: `{#for children of list}<slot/>{/for}`
   asks the outlet to invoke the loop item. `rewriteExpr` sees expressions only, so it reached that form
   solely when the body happened to REFERENCE the name — and a body spelling the outlet as `<slot/>`, the
   spelling this clause mandates, never does. So the one form cited here as the REASON for the reservation
   was the one form that compiled, and it failed at RENDER with `<children> is not a component in scope`,
   pointing at the outlet rather than at the binding that shadowed it.

   Only a LEXICAL `children` is exempt — a `<script>` binding, which stays lexical in the emit and never
   touches `$scope`. An inline component's param is **not** lexical and is therefore not exempt:
   `genComponentDef` writes `$s.children = $args[1]` and then binds the declared params over that same
   `$s`, so a param of that name collides with the children rather than shadowing them. Named-slot /
   render-prop needs are met by **inline components passed as props** (a nested `{#component}` inside
   `<Foo>` becomes Foo's same-named prop).
3. **Inline components** — `{#component Row(props)}…{/component}` (TitleCase; a lowercase name
   is a parse error — lowercase is reserved for element tags) invoked as a tag `<Row/>`; compile to
   fragment-builder (client) / string-builder
   (server); **first-class values passable as props**. `<slot/>` renders the default children; a
   nested `{#component X()}` inside `<Foo>…</Foo>` is forwarded to Foo as its `X` prop (the
   render-prop/named-slot mechanism). A cell- or memo-named tag (`const C = memo(…)`) is a **reactive**
   component that re-mounts on identity change. A component-valued prop types as `Component<Props>`.
   A tag may also be a **member path** — `<item.Icon/>`, `<Icons.Chevron/>` — which renders the
   component held there; the head is any binding in scope (a `{#for}` item, a prop, a cell), and
   TitleCase applies to the component's NAME, i.e. the LAST segment (`<item.icon/>` is a parse error).
   A member tag is reactive like a cell-named one: it is an expression over bindings rather than an
   import, so the component behind it can change while the mount stays put. The discriminator is a
   dot, and the tiebreaker against a dotted CUSTOM-ELEMENT name (`<my-el.foo>`, legal HTML) is the
   hyphen — a hyphen keeps the tag an element. Classified off the first character alone,
   `<item.Icon/>` used to emit a literal `<item.Icon>` element with no error at all.
4. **`{...expr}` spread** — props onto components, attributes onto elements; reactive.
5. **No `onMount`/`onDestroy`.** `<script>` body = setup; effect/`watch`/`bind:element`-fn
   teardown = cleanup. The emitted `mount` AND `render` run the setup preamble inside an open **effect
   scope**, so the instance owns every `watch` its script created: unmount disposes them on the client,
   end of request on the server (a render is a component's whole life there). That ownership is what
   makes the returned teardown a real lifecycle hook (rpc-core §7.5) rather than a re-run-only one, on
   both sides.
6. **Capitalized tag = component**, lowercase = element (sole discriminator; components must
   still be in scope/imported).

## C5. `bind:element` (node ref + lifecycle, unified)

`attach` is **removed**; `bind:element` overloads on value type, disambiguated at
**compile time** (declared `state` cell vs function expression):

- **`bind:element={cell}`** → reactive ref: assigns the node to the cell. The documented
  default for "I just need this node" (focus, measure, pass to a lib). Lifecycle via
  `watch(cell, …)`.
- **`bind:element={fn}`** → attachment: exactly shorthand for
  `let el = state(); watch(el, node => { …; return teardown })`. Runs **per instance** with
  the node, return = teardown, and **works inside `{#for}`** (the reason `attach` existed).
- Both-at-once: `bind:element={n => { el = n; setup(n); return teardown }}`.

## C6. Pages, layouts, routing, navigation

1. **File-based routing = filesystem route tree.** `pages/foo/page.abide` → `/foo`; nested
   dirs nest routes. `layout.abide` wraps nested routes; **the layout's outlet is `<slot/>`**
   (C4.2). Dynamic segments: `[name]` **required** (captured into `route().params.name`);
   `[[name]]` **optional** (matches zero or one segment — absent → the param is omitted);
   `[...name]` **rest/catch-all** (terminal — captures the remaining segments as a `/`-joined
   string). **Match precedence** picks the most specific: an all-literal (exact) route wins
   outright; otherwise patterns rank segment-by-segment `literal > required > optional > rest`,
   a longer pattern breaks a tie, and iteration order (loadApp-sorted) is the final tiebreak.
2. **Layouts persist across same-chain nav** — the layout's effect scope survives; only the
   child outlet subtree remounts. State preserved.
3. **`route()` is the single isomorphic reactive accessor** (FD2; `page` is retired) —
   `route()` → `{ kind, name, params, url, navigating }`, derived from the request and usable
   in both middleware (all kinds) and templates. Reading `route().params.id` subscribes;
   same-route param change re-renders dependents without full remount (the whole nav chain is
   kept alive — C6.3, C6-nav). `navigating` is inert server-side; for `rpc` kind, `params` is
   the args object.
4. **First load = full SSR (§5/§6) + hydrate (C2). Subsequent same-origin nav = client-side
   (History API), but every nav round-trips the server (C6-nav).**
5. **No separate loader convention.** Page data = in-template RPC reads (C3), which SSR-
   stream on first load and fetch on client nav. `navigate(path, { replace?, keepScroll? })`
   = imperative nav; `url(path, args?)` = type-safe in-app href resolver.

### C6-nav. Per-navigation server round-trip

**Every nav hits the server so the app middleware chain runs (auth/log/redirect).** One
server render/read path serves **three nav shapes**, each keeping as much of the live chain
alive as it soundly can (remount only the part that actually diverges):

- **First load** (no `Abide-Nav` header — hard load / refresh / crawler / pasted link) →
  full SSR **HTML + §5 seeds**, then hydrate (C2).
- **Same-route param/query nav** (`/users/1` → `/users/2`, same page pattern, different
  `[id]`/query) → **whole chain kept alive (C6.3).** The client republishes `route()`
  optimistically and lets `route()`-driven bindings and param-keyed reads **re-fire reactively
  in place** — no dispose, no DOM swap, no re-hydration, so local `state`, scroll, focus, and
  element state are all preserved. The server round-trip still happens (the `Abide-Nav` fetch);
  if middleware short-circuits, the client follows the `{redirect}`. Otherwise the confirm is a
  **full render of the destination**, and the client drains its frame stream for the trailing
  `{kind:"seed"}` frame and **replays that seed's reads/streams into the LIVE mount's memos**
  (`replaySeedIntoProxies`), re-adopting `identity` with it. The shell and `fill`/`append`
  patches are dropped — they address DOM this nav deliberately did not adopt; once the memos hold
  the new values, re-rendering is the reactive graph's job.

  The seed used to be discarded here, on the premise that "the kept page's reads have already
  re-fetched reactively". That holds only for a read the nav actually MOVED: a param-keyed read
  lands on a new cache key and loads cold. A read taking no args and reading no `route()` has
  nothing to re-fire ON — so on a nav to the URL you are already on, NOTHING re-fired, and the
  server recomputed the whole page while the tab kept painting the value its ∞-`ttl` slot loaded
  on first paint. The same nav shape rendered fresh when reached by nav-away-and-back, because
  that path hydrates and hydration replays the seed; only the kept-mount path had no channel to
  the memos. Replaying is that channel.

  This is **not** a round-trip saving, and was never going to be one: the `route()` republish is
  OPTIMISTIC, so a param-keyed read has already kicked its cold load by the time the confirm's
  seed lands. Folding the two would mean blocking the republish on the server, which is the one
  thing this nav shape exists not to do. `seed` is authoritative over a retained slot, so a
  late-arriving seed overwrites; an identical value wakes nobody (§7.3).

  A nav whose resolved target (path + query + **hash**) equals the current location touches
  history not at all — no `pushState`, and no `replaceState` either, since the URL already IS the
  target and a replace would only wipe the entry's own state (including `stampScroll`'s offset).
  Pushing there stacked a second entry on one URL, so Back landed where it started.
- **Cross-route nav** (destination is a different page pattern) → the client keeps every
  **outer layout it SHARES with the destination alive** (the longest common layout prefix —
  `sharedLayoutDepth`, the client mirrors it) and **grafts + claims only the diverging suffix**
  into the innermost kept layout's outlet. A fully-disjoint route (no shared layout) swaps the
  whole outlet. State in the kept prefix is preserved; the diverging suffix is naturally new —
  this is the scoped **remount** case (C6.2).

A **traversal** (Back/Forward) is one of the three shapes above, not a fourth — but it cannot read
its own `Abide-Nav` off `location`, because the browser moves `location` to the destination *before*
firing `popstate`. So the client tracks the mounted route's path (`currentPath`) and names that. It
used to send `location.pathname`, i.e. the destination announcing itself as its own origin: the
server then answered `sharedLevels` for a from==to nav — the destination's FULL layout depth — while
the client had computed `keep` against the route it actually had mounted. `partialCrossNav` reads
that disagreement as "not the suffix I am set up to graft" and hard-loads, so **every cross-route
Back/Forward whose two ends did not sit under the same layouts was a full document load**: the live
chain discarded, hydration re-run, and the kept-layout state the graft exists to preserve gone with
it. The content still came back — which is why a content-only assertion never caught it.

**A nav that starts while another is streaming.** A partial cross-nav grafts the destination's shell
at the START of its frame stream and CLAIMS it at the end — on a streaming destination, seconds
apart. Two rules cover that window:

- The route bookkeeping (`currentPattern`/`currentPrefixes`/`currentPath`) commits at the **graft**,
  because that is when the DOM and `route()` become the destination's. It used to commit at the
  claim, so for the whole window it named a route that had already left the screen and a nav
  starting inside it was classified against that ghost — a Back to the route just departed matched
  the stale pattern, was taken for a same-pattern param nav, and "kept" a mount showing the other
  page: permanently wrong content under the right URL.
- The two shapes that KEEP a live mount (param/query and partial cross-nav) additionally require the
  mount to be **claimed**. A grafted-but-unclaimed subtree has no live effects to keep, and
  `graftSuffix` is not re-entrant — it disposes a holder the claim has not yet repointed and inserts
  before the same anchor, so a second graft would double-dispose and leave BOTH suffixes in the
  document. A nav arriving in the window therefore takes the **full path**, which rebuilds
  unconditionally and so is correct from any DOM state. This is deliberately gated on "has the DOM
  been touched", not "is a nav in flight": a nav superseded *before* its shell landed left the DOM
  alone, so it keeps its optimizations — that is the ordinary impatient-clicking case.

A superseded nav must also STOP, so `navGen` is re-checked before every frame it applies, before the
claim, and after the destination chunk resolves — not once after the fetch, which on a streaming body
is a check made seconds before the mutations it was guarding.

### C6-nav headers: `Abide-Nav` and `Abide-Nav-Keep`

`Abide-Nav: <from-path>` names the route being LEFT, and its presence is what marks the request a soft
nav. Absent it, the response is a full document.

`Abide-Nav-Keep: <n>` is how many outer layout levels the client is KEEPING, and where it is sent it
**decides** what the server renders (`levels.slice(keep)`). The router can derive a number of its own
from `from` — `sharedLayoutDepth(from, to)` — and does for a caller that sends none, but that answers a
**different question**: what the route TABLE permits, which is static. How much a live page can actually
keep depends on facts only the client has — whether a chain is mounted at all, whether it has been
claimed, whether the boundary record carries a `graftSuffix`. They coincide often enough that the
derivation is a fine default, and diverge often enough that when the client sends a number it must win.

This replaced a runtime reconciliation. The shell carries `sharedLevels`; the client used to compare it
against its own `keep` and **hard-load on a mismatch** — two independent derivations of one number with a
document load as the tiebreak. One number, one derivation, and the disagreement is unrepresentable; the
check is gone. What remains beneath it is `claimSuffix`'s existing recovery: a suffix that cannot be
claimed is fresh-mounted from the client's own levels, which is also what a genuinely skewed deployment
now degrades to instead of reloading. *(Version skew is not otherwise detected. A build id on the nav
response is the honest mechanism if that becomes load-bearing.)*

**What each shape declares:**

| Nav shape | `keep` | Why |
| --- | --- | --- |
| whole-container | `0` | replaces `#__abide-app` outright, so it keeps nothing |
| partial cross-nav | the graft depth | the number it is about to graft at, by construction |
| param/query move | every level it has | it keeps its whole chain; equals what the server would derive |
| param/query, prefixes unknown | *(omitted)* | `0` would be a false claim and buy a full render for nothing |
| **same-URL** | `0` | see below |

A nav to the URL you are already on is a **refresh gesture**, and the layouts are part of what is on
screen. Left to derive, a same-pattern nav skips every layout level (from == to, so the depth is that
route's full depth) and renders the page alone — so only the page's reads reach the seed, and a
**layout's** route-independent read would keep painting its first-paint value exactly as the page's did.
`keep: 0` renders the whole tree so the seed carries those too. Same-URL only: a param MOVE should leave
kept layouts alone (persisting is the point of keeping them) and would otherwise pay for a full render on
every step of a carousel.

Server-side the declared value is **clamped to the destination's own layout depth** — a client cannot
keep levels that do not exist, and an unclamped over-count would slice past the end and ship an empty
shell. A malformed value **falls back to the derivation** rather than erroring, because falling back
renders more of the tree and more is always placeable. `Number('')` is `0`, so an empty value must be
rejected *before* parsing, or the empty header reads as the field's most consequential value.

Both nav responses `Vary` on **both** headers: the first picks document-vs-frame-stream, the second picks
how much tree the stream carries.

Mechanism:

- **Server-driven streaming nav (option A).** Reuses the single server render path (→ HTML)
  and single client attach path (hydrate). Rejected alternative (B: hook-only + client
  render) would create a second, client render path — against dev/build consistency.
- **Request:** the nav requests the **destination URL** (`GET /users/2`) with a header
  `Abide-Nav: <current-route path>`. The header (a) marks it a soft-nav → return a JSONL frame
  stream, not a full document; (b) carries the current route → the server computes
  `sharedLayoutDepth(from, to)` (the longest common layout prefix) and renders **only the
  diverging suffix** `levels.slice(sharedLevels)` (the shared outer layouts are not
  re-rendered), **capped by `Abide-Nav-Keep`** where the client sends one (see the headers section
  above). No header (first load / hard refresh / crawler / pasted link) → full document.
  Server sends **`Vary: Abide-Nav, Abide-Nav-Keep`** so caches/CDN key the response shapes separately.
- **Response (a streamed JSONL frame stream, §PR4):** `{kind:"shell", html, url, sharedLevels}`
  first — the diverging-suffix HTML plus how many outer layouts the client is keeping; then a
  patch frame per streamed subtree as it resolves (`fill`/`append`/`complete`, keyed by slot
  `id`, §6 out-of-order); then `{kind:"seed", seed}` last (§5 cache seeds so the suffix's reads
  don't re-fetch). A middleware short-circuit instead arrives as a JSON `{redirect}` envelope
  (checked before the stream) — a structured redirect the client re-navigates, not a blind 302.
- **Client:** a **monotonic newest-wins nav token** stamps each nav; a superseded response
  (a redirect or graft from an older nav) is dropped before it can touch the DOM. Then, by
  shape: **same-route param/query** → republish `route()` and let reactive reads re-fire in
  place (the fetch is only the background middleware/redirect confirm above); **cross-route** →
  read the frame stream, verify the shell's `sharedLevels` matches the depth the client is
  keeping, **graft** the suffix HTML into the innermost kept layout's outlet, fill each patch,
  then **claim** (the same C2 attach/hydrate pass, scoped to the suffix). A nav to a
  not-yet-loaded route fetches its code-split **client chunk in parallel** with the frame stream
  (its `levels`/`prefixes` drive the shared-depth math). Nav **never dead-ends**: a shell/depth
  disagreement or a claim mismatch degrades to a scoped fresh-mount of the suffix, and a
  network/parse failure to a hard `location.href` load. Accepted cost: each nav ships the server
  response + (if new) the route chunk — more bytes/CPU than data-only SPA nav, the price of the
  server-middleware guarantee.
- **Scroll.** A forward nav resets to the top the moment the **shell frame** lands — not when the
  frame stream closes, or a streaming page (a `{#for await}` running for seconds) would leave the
  reader scrolled through the new page and then jump them to the top when it finally ends. The
  reset is `behavior: 'instant'`: it is a document-load reset, not an in-page jump, so an app's
  `html { scroll-behavior: smooth }` must not animate it (an animated one gets starved by the
  render/hydrate work that follows, and lands late as the same surprise jump). `keepScroll` opts out.
  **Back/forward stays the browser's** — `history.scrollRestoration` is left `'auto'`, so it keeps
  owning reload, bfcache, `#anchor` targets, and the ordinary traversal. abide only **corrects** the
  case the browser structurally cannot reach: it restores synchronously at traversal time against
  the OUTGOING page's layout, while the destination is still a fetch + stream away, so an offset
  deeper than that page's max scroll is CLAMPED with no later hook to revisit it. So a push
  **stamps** the leaving entry's offset into its own `history.state`, and a traversal re-applies it
  once the shell lands and again once the stream closes (the page grows after the shell). No
  stamp → the browser's answer stands; the correction is strictly additive. An entry left via a
  traversal rather than a push carries no stamp (capturing it would mean racing the browser's own
  restore) — that case keeps plain browser behavior.
- **The middleware chain = `src/app.ts` `export const middleware = [...]`** (FD1), running on
  **every server-touching request except static assets** (RPC and nav alike, §13.4 uniform
  auth). Each entry is onion middleware `(next) => Response` (`async (next) => { … return await
  next() }`, global wraps per-RPC wraps handler); `next()` takes no args (request via
  `request()`), so the passthrough is `next => next()`. A middleware can **observe** (log/trace)
  and **decide** — short-circuit by calling `redirect(...)`/`error(...)`, which **THROW** (both
  return `never`); the chain renders a thrown outcome at its own status exactly as it renders a
  returned `Response`, which is still admitted. **Auth is just middleware**: a guard is a middleware
  that calls `error(403)` instead of calling `next` (arg-level checks read `route().params`). This
  partially un-parks `app.ts` — at least its per-request middleware chain is in this slice.

## C7. Two-way binding

1. **`bind:value={cell}` = sugar for `value={cell}` + `oninput={…}` writeback** (visible,
   no hidden magic; coerces by input type — number inputs → `number`). Event handlers use
   **native `on*` attributes** (`oninput`/`onchange`/`onclick`), not `on:event`. `<select>`
   and other change-driven elements use `onchange`.
   **On a COMPONENT the same syntax is an ordinary PROP** named `onclick` — there is no element to
   attach a listener to, so passing it through is the only thing it can mean; the component places it
   on an element of its own, or spreads it. Both emitters pass it. The SERVER used to drop it while
   the client passed it, which is an isomorphism break rather than a missed optimisation: a component
   that branches on the prop (`{onclick ? … : …}`) rendered one thing in the SSR HTML and the other
   after hydrate, so the two paints disagreed about the props the component received.
2. **`bind:group={cell}`** — radios write the selected value; checkbox groups maintain an
   **array** in the cell.
3. **Derived `bind:value={{ get, set }}`** = the general primitive `bind:value={cell}` is
   sugar over (`cell` → `{ get: () => cell, set: v => cell = v }`). For transformed/
   validated/nested targets. **Works on component props too** (bindable props — child writes
   back into a parent cell).
4. **SSR:** binds render the current value into the HTML attribute; the writeback listener
   wires on hydrate (binds are inert server-side).
5. **Binds are transport-only (value ↔ cell).** Validation/field-errors
   (`clients.browser.validate` / `ValidationErrorData.fields`, §10/§12) read the cell and
   surface errors separately — not carried inside `bind:`.

## C8. Control-flow blocks

1. **`{#if}/{:else if}/{:else}`** — reactive condition mounts one branch; switching disposes
   the old subtree's effect scope and mounts the new. Static branches are C2-skip-eligible.
2. **`{#for item, i of list by key}` = keyed reconciliation.** `by key` matches items and
   **moves/reuses DOM + preserves each item's effect scope/state** for survivors; creates
   new; removes gone. **`by key` is optional** — omitted → positional re-render (no identity
   preservation); a keyless `{#for}` whose body has stateful bindings (`bind:`, nested `<script>`,
   `bind:element`) can strand that state on reorder, since positional reuse rebinds an item's DOM to a
   different value. **The dev warning for this is NOT built** — it never was, and it now has something
   real to warn about: before branch-local `<script>`s existed, a loop body could hold no state of its
   own, so the only case was `bind:`. **Index `i` is reactive but wired only when referenced** — if the body
   doesn't use `i`, no index tracking (zero cost, the common case); when used, `i` updates on
   reorder/splice without remount (a head-splice's O(n) updates are correct-by-necessity but
   are state writes only — keys preserve DOM identity, no reflow).
3. **`{#for await item of source}`** — consumes an `AsyncIterable`/`Stream` (§12), rendering
   items as they arrive; `{:catch e}` handles stream error; SSR drains to a boundary (§12.4).
4. **`{#switch subj}{:case v}{:default}`** — reactive subject mounts the matching case;
   others unmounted.
5. **`{#try}{:catch e}{:finally}` = subtree render/effect error boundary**, behaving **like
   JS try/catch**. Catches errors thrown during render/effects below it, **including an
   uncaught reactive read error** (§9.2) not handled by a local `{#await}{:catch}`. Hierarchy:
   per-read `{:catch}` handles that read locally; `{#try}` is the catch-all boundary; no
   enclosing boundary → propagate to nearest ancestor, ultimately a framework default.

## C9. Styles, scripts, leaf directives

1. **Root `<style>` = component-scoped** (compiler-generated marker attribute + selector
   rewrite; no leak in/out). **Tailwind is the recommended but *optional* styling path** —
   scoped `<style>` works standalone; `<style>` covers what utilities can't (keyframes,
   complex/pseudo selectors).
2. **Nested `<style>` = branch-subtree-scoped.** Each level carrying a `<style>` establishes its own
   attribute, and an element stamps EVERY attribute in force — so a component's own rules still reach
   into an inner-scoped subtree while the inner rules cannot reach out. A root `<style>` is not a
   special case, just the outermost level's. (Before, the attribute came only from a ROOT `<style>`, so
   a nested one was scoped file-wide — or, in a file with no root style, not at all.)
3. **Root `<script>` = per-instance setup** (runs once per instance; fresh `state`; imports
   + functions). **`<script module>` = module-once** (shared constants/singletons, run once
   regardless of instance count) — **in scope**.
4. **Nested `<script>` = branch/iteration-local reactive state** — `state`/`memo` created on
   branch mount, disposed on unmount, reusing root imports. In `{#for}` this is **per-item state**
   (which is why a `{#for}` iteration opens its own hydration-seed bucket — `seededState.ts`).
   Its bindings are PUBLISHED ON THE LEVEL'S `$scope`, not lexical: every template level below is a
   separate emitted mount function on the client, so a lexical `let` would be invisible one level down.
   Keeping those names out of `declared` is the whole mechanism — that alone makes the shared
   free-identifier rewrite qualify them, and makes a name that shadows a root binding resolve to the
   branch's. **Where one may go is gated** (`analyzeBindings.walkNestedScripts`), because every rejected
   position is one where it would otherwise run never or twice: it must be the FIRST node of a BLOCK
   BODY (an `{#if}`/`{:else}` branch, a `{#for}` body or its `{:catch}`, an `{#await}` branch, a
   `{:case}`, a `{#try}` branch, a `{#component}` body). Inside an element or a component's children —
   neither of which has a lifetime or a frame of its own — a second one in the same body, a second
   ROOT-level `<script>`, a nested `<script module>`, or an `import` (module-level wherever written, so
   one here could only look conditional) are all loud errors naming the fix.

   **No `<script>` of ANY of the three kinds may carry an `export`** — module, instance, or
   branch-local — and it is a loud error in **both** lanes (`abide check` and `abide build` ask the
   one gate). None of the three is an ES module BOUNDARY: each body is inlined into the emitted
   component's setup (`$ensureModule($scope)` / `render` / `mount`), so an `export` lands inside a
   function and is a syntax error in the EMITTED module. The gate used to skip the keyword, which
   made `export const x = 1` analyze and bind exactly as `const x = 1` — everything downstream
   agreed the script was fine, and the only symptom was a parse failure over generated source. The
   message names the fix, because nothing an `export` here could reach for is unavailable without
   it: a top-level binding is already visible to the template and to every nested `<script>`, a prop
   is `const { x } = props()`, and a value shared across FILES belongs in a `.ts` module you import.
5. **Leaf directives:** `class:name={cond}` toggles a class reactively; `style:prop={val}`
   sets one style property reactively; `{html(expr)}` injects raw unescaped HTML (author
   owns XSS — all other `{expr}` is escaped by default); `{...expr}` spread (C4.4).
   **`class:`/`style:` are ELEMENTS ONLY** — on a component either is a compile error in both lanes
   (`templatePlan.rejectElementOnlyDirectives`), because the directive targets ONE element and a
   component renders a subtree (possibly several roots, possibly none), so there is no node it could
   name. The check lane used to type them as ordinary props while both emitters silently DROPPED
   them, which is the worst pair available: the author was told the markup was valid and nothing
   rendered. The message names the fix — pass a prop and let the component place it
   (`<Card class={…}/>`).
6. **Reference rewriting: a binding IS its value (ADR 0024).** `analyzeScope` classifies each simple
   declaration and rewrites every reference to it:
   - `let n = state(…)` / `state.shared(…)` / `memo(…).state()` → a **cell**: read `n` → `n()`, write
     `n = x` → `n.set(x)` (plus compound/`++`/`--`).
   - `const d = memo(…)` → an **auto-called memo**: read `d` → `d()`. Read-only, so a write form is left
     verbatim and the `const` binding makes it a loud `TypeError`.
   - **A member access reads the VALUE, for both** — `{d.length}` is `d().length`, not the memo object's
     `length`. The consequence is that a memo's own surface is NOT reachable through the binding; probes
     belong to RPC/socket callables, which are imports, and imports are never rewritten. `abide check`
     unwraps the binding to its value, so `d.peek()` fails on both sides rather than silently returning
     the wrong thing.
   - **No dependency-position exception (ADR 0025).** A `watch`/`memo` source is always an argless
     THUNK, so every identifier inside it is an ordinary read and the rewriter has ONE rule, not two:
     `watch(() => count, handler)`, `memo(() => a, (v) => v + 2)`. A bare cell in that slot reads as a
     value, which is a type error at the call (`number` is not `() => T`) — the right diagnostic, since
     the thunk is not optional. Several inputs need no syntax of their own: they are what the thunk
     returns, `memo(() => ({ a, b }), ({ a, b }) => a + b)`.
   - **Auto-call needs a visible argless fn literal at the declaration** — `memo(() => …)`, with or
     without a transform. `memo(someFnRef)` is opaque, an ARGS-taking body is a keyed callable rather
     than a value, and an `async` argless body would produce a promise-returning read that blanks the
     server-rendered text (see `promise-read-model.md`); none auto-call, so all stay plain `const`
     bindings.
7. **Two `<script>` lowerings, one scanner.** The RUNTIME lowering (`analyzeScope` → the emitted
   `render`/`mount`) runs in-process on the SSR/build hot path; the TYPE-CHECK lowering (C10) runs
   out-of-process in `tsgo`. Both are **token-scanner-based, not AST-based** — TS7 ships **no
   in-process parser** (`typescript/unstable/ast` exposes only `createScanner`; the Go port's parse+
   check live behind the `tsgo` process). So the runtime pass reconstructs imports / cell decls /
   `state`·`props` calls from the token stream, and carries a few documented sharp edges:
   - **Type-only imports are erased from the runtime scope** — `import type { T }` and a `{ type T }`
     specifier are dropped (never aliased to `$scope`); a `{ type as x }` VALUE binding is kept. They
     stay resolvable in the check pass (which copies the raw `<script>` verbatim).
   - **Generic call forms are recognised** — `state<Foo[]>(…)`, `memo<T>(…)`, `props<T>()`
     lower as cells/props (a balanced `<…>`, incl. nested `>>` and `=>`, is skipped before the `(`); a
     `state < 5` comparison is not misread.
   - **Known limit:** a generic type arg with a TOP-LEVEL COMMA (`state<Map<K, V>>(…)`) is NOT
     recognised — the `<`/`>` generic-vs-comparison ambiguity is only resolvable by real (typed)
     parsing, which isn't available in-process. Workaround: a single-arg generic (`Array<T>`) or a cast
     (`state([] as Map<K, V>)`). Closing it in-process would need a speculative token mini-parser
     mirroring TS's own backtracking heuristic.
   - **Migration note (no in-process TS7 parser is coming):** don't wait on TS7 for this. The Go-native
     port (TS7, GA 2026-07) drops the classic in-process JS compiler API ("Strada" — `createSourceFile`/
     `forEachChild`); `typescript/unstable/ast` exposes the node model + factory + visitors, but a PARSED
     tree comes only via `unstable/sync` (the out-of-process `tsgo` bridge — the pipe that doesn't run
     under Bun). The TS team has publicly leaned toward an **IPC** API and called a public in-process API
     "unlikely" (microsoft/typescript-go #481). So the runtime lowering stays scanner-based; the only
     ways to get a real AST are (a) the out-of-proc `tsgo`/`abide check` path (already used for typing,
     too heavy per-render), or (b) a build-only classic-`typescript@5` dep (against the minimal-deps
     goal). The speculative token mini-parser is the pragmatic in-process option if the comma case ever
     matters.

## C10. Type-checking & tooling (`abide check` / `abide lsp`)

A "type-safe template language" lives or dies here. The model reuses TypeScript, never a
bespoke checker.

1. **Type-checking = generate a TS representation of the `.abide` file, then check it with
   TypeScript 7** (the svelte-check model). The `.abide`→TS transform emits a typed module; TS7
   checks it; **errors map back to `.abide` source spans.** No custom type-checker.
2. **Every reactive expression is checked against real types** — `{user.naem}` → error;
   `attr={expr}`, `on*={fn}` (handler arg types on an ELEMENT; on a component the same attribute is a
   PROP named `onclick` and is checked as one, C7.1), `bind:value` (element value type), `class:`/
   `style:` (elements only — on a component both are an error, C9.5). Nothing is stringly-typed.
3. **Isomorphic type flow reaches templates (§6).** `{user(args)}` is typed against the RPC's
   input/output via the client-proxy type (§6.2, type-only import) — args checked, awaited value
   typed, **from the server handler's signature, zero manual annotation.**
4. **Cross-component prop checking.** `<Foo bar={x} />` checks `x` against `Foo`'s `props<T>()`;
   missing/extra/mismatched props error; inline-component params (C4.3) and `bind:` props (C7.3) checked.
5. **Control-flow blocks preserve TS narrowing** — `{#if x}` narrows in-branch, `{#await}{:then
   v}` types `v`, `{#for item of list}` types `item`, `{:catch e}` types `e`, `{#switch}{:case}`
   narrows. The generated TS preserves flow narrowing.
6. **Generated `src/.abide/*.d.ts` drive typed routing** — route params (`[name]`/`[...name]`
   required, `[[name]]` optional → `route().params.name`), `url(path, args)` type-safe against
   the route tree, typed `navigate` targets — all from generated types keyed to the filesystem
   routes. `url(path, params?, query?)` fills `[name]` (required), `[[name]]` (optional — an
   absent param drops the segment), and `[...name]` (rest — a `/`-joined string, each part
   encoded); an all-optional path makes the params argument itself optional. The bracket forms are
   the whole grammar — a `/:name` colon segment is a LITERAL, the same reading `matchRoute` gives it.
   (It was once filled as a required segment by `resolveUrl` alone: the param types never derived a
   key from it and the router never matched one, so `url('/users/:id', { id: 7 })` built `/users/7`,
   a link no route could resolve.)
7. **`abide check` (batch/CI) and `abide lsp` (editor: diagnostics/completion/hover/go-to-def/
   signature-help/find-references/**semantic-tokens** over stdio) share one core** — the
   `.abide`→TS transform + a TS language service. `check` is a one-shot run of what `lsp` does
   live. The semantic-tokens pass is markup-only (colored from the one parse walk, not the TS
   shadow); the Zed extension (`packages/zed-abide`) consumes it.

---

## Deferred / parked (rule before implementation)

- **Lazy-mount island triggers** (`on-visible`/`on-idle`/`on-interaction`) — C2.
- **`src/app.ts`** beyond the per-request middleware chain (lifecycle hooks `onStart`/`onStop`/
  `onHealth`/`onError`, etc.) — only the request/nav middleware chain (`export const middleware =
  [...]`, FD1) is specced here (C6-nav).
- **Full socket API** (`tail`/`maxAge`/`clientPublish`/`schema`/`clients`) — the multiplexer is
  the §8 broadcast channel; its authoring surface is a later slice.
- **`abide check`/`lsp` completion/hover/refactor UX depth** (C10 fixes the model — TS-service-
  backed diagnostics/completion/hover/go-to-def; polish and refactorings are unspecified).
- Cross-refs now specced elsewhere: `env(schema)` → `config-observability.md`; observability →
  same; desktop `bundle` → `bundle.md`; `compile`/`cli` → `machine-surfaces.md`/`build-pipeline.md`;
  OpenAPI/MCP → `machine-surfaces.md`.
- **Element-level scroll** across a nav (an `overflow` strip's own offset) — unspecced. The soft-nav
  DOM swap destroys and recreates those nodes, so nothing restores them; only `abide dev`'s
  live-reload does, via its own sessionStorage snapshot (`build-pipeline.md`).
