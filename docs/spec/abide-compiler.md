# abide — `.abide` Template Compiler (Spec, Slice 2)

Status: draft, derived from design interview 2026-07-17.
Scope: the `.abide` template compiler and its runtime. Builds directly on the RPC / read
core (`docs/spec/rpc-core.md`); section refs like §7 point there, C-refs point here.

Through-line: `.abide` is a **Svelte-family AOT compiler over the §7 fine-grained signal
substrate**. There is no VDOM and no runtime template interpreter. Components are
structured collections of §7 effects. The server render path (→ HTML) and the client
attach path (→ hydrate) are each **single paths reused for first load and every
navigation**.

---

## C1. Compilation model

1. **No-VDOM, fine-grained, signal-driven.** `{expr}` → text node + effect subscribed to
   the read; on change, write `node.textContent` directly. `{#if}` → mount/unmount a
   subtree. `{#for … by key}` → keyed reconciler over real DOM. No diffing.
2. **One `.abide` file → two compiled outputs**, selected by build (mirrors §6 module-swap):
   - **client module** — DOM-construction + signal-wiring instructions;
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

1. **`{fn(args)}` = reactive peek** — an effect reading the §7 slot signal; renders
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
   reads compile to §7 signal reads; parent `name={expr}` change updates the child; defaults
   apply on absent/`undefined`; `...rest` is a reactive collection.
2. **One slot `{children()}`; no named slots.** Fallback = `{#if children}{children()}
   {:else}…{/if}`. Named-slot / render-prop needs are met by **snippets passed as props**.
3. **Snippets** — `{#snippet row(item)}…{/snippet}` called `{row(item)}`; compile to
   fragment-builder (client) / string-builder (server); **first-class values passable as
   props** (the render-prop/named-slot mechanism).
4. **`{...expr}` spread** — props onto components, attributes onto elements; reactive.
5. **No `onMount`/`onDestroy`.** `<script>` body = setup; effect/`watch`/`bind:element`-fn
   teardown = cleanup.
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

1. **File-based routing = filesystem route tree.** `pages/foo/page.abide` → `/foo`;
   `[name]` → `route().params.name`; nested dirs nest routes. `layout.abide` wraps nested
   routes; **the layout's outlet is `{children()}`** (C4.2).
2. **Layouts persist across same-chain nav** — the layout's effect scope survives; only the
   child outlet subtree remounts. State preserved.
3. **`route()` is the single isomorphic reactive accessor** (FD2; `page` is retired) —
   `route()` → `{ kind, name, params, url, navigating }`, derived from the request and usable
   in both middleware (all kinds) and templates. Reading `route().params.id` subscribes;
   same-route param change re-renders dependents without full remount (the seeds-only mode,
   C6-nav). `navigating` is inert server-side; for `rpc` kind, `params` is the args object.
4. **First load = full SSR (§5/§6) + hydrate (C2). Subsequent same-origin nav = client-side
   (History API), but every nav round-trips the server (C6-nav).**
5. **No separate loader convention.** Page data = in-template RPC reads (C3), which SSR-
   stream on first load and fetch on client nav. `navigate(path, { replace?, keepScroll? })`
   = imperative nav; `url(path, args?)` = type-safe in-app href resolver.

### C6-nav. Per-navigation server round-trip

**Every nav hits the server so the app middleware chain runs (auth/log/redirect).** One
server render/read path serves **three emission modes**, reconciling remount vs
state-preserved:

- **First load** (no `Abide-Nav` header — hard load / refresh / crawler / pasted link) →
  full SSR **HTML + §5 seeds**, then hydrate (C2).
- **Cross-route nav** (destination is a different page/layout) → server-driven **HTML** for
  the diverging outlet down; the client swaps that outlet DOM and runs the C2 attach pass.
  State below the divergence is naturally new — this is the **remount** case.
- **Same-route param nav** (`/users/1` → `/users/2`, same page, different `[id]`) →
  **seeds-only mode**: the server round-trip runs the middleware chain and re-executes **only
  the param-dependent reads**, streaming **§5 cache seeds and NO outlet HTML**. The client
  **keeps the component instance**; `route().params` (a signal) updates; param-keyed reads
  update **fine-grained** (surgical DOM patch — no swap, no re-hydration, local `state`
  preserved). This is the **state-preserved** case (C6.3).

Mechanism:

- **Server-driven streaming nav (option A).** Reuses the single server render path (→ HTML)
  and single client attach path (hydrate). Rejected alternative (B: hook-only + client
  render) would create a second, client render path — against dev/build consistency.
- **Request:** the nav requests the **destination URL** (`GET /users/2`) with a header
  `Abide-Nav: <current-route>`. The header (a) marks it a soft-nav → return fragment, not
  full document; (b) carries the current route → server renders only from the **first
  diverging layout/outlet down** (persisted layouts not re-rendered). No header (first
  load / hard refresh / crawler / pasted link) → full document. Server sends
  **`Vary: Abide-Nav`** so caches/CDN key the two response shapes separately.
- **Response (streamed, interleaved):** (1) nav-control metadata — a **structured redirect
  instruction** (client updates `route()` + re-navigates, not a blind 302) or the resolved
  new `route()`; (2) for first-load/cross-route, the changed outlet subtree as **HTML**
  (out-of-order, §6) — same format as first load, minus the persisted shell, and **omitted in
  seeds-only param nav**; (3) the §5 `<script type="application/json">` cache seeds so new
  reads don't refetch.
- **Client:** apply nav-control → (cross-route) swap outlet DOM with streamed HTML and run the
  **same C2 attach/hydrate pass** over the new subtree, or (same-route param) keep the instance
  and let the seeded param-keyed reads patch fine-grained → seed cache either way. A nav to a
  not-yet-loaded route fetches its code-split **client chunk in parallel** with the HTML/seeds
  (HTML is inert until the chunk attaches). Accepted cost: each nav ships the server response +
  (if new) the route chunk — more bytes/CPU than data-only SPA nav, the price of the
  server-middleware guarantee.
- **Seeds-only mechanism = server-produces-seeds.** For param nav the server runs the
  component's read graph and **discards the HTML** (SSR-minus-emission), streaming just the
  seeds. Chosen over client-drives-reads because a middleware round-trip is mandatory every nav
  anyway (C6.4): server-produces-seeds folds the data onto that one request (1 round-trip,
  reads next to the DB) vs client-drives (1 middleware request + N read fetches). **DOM cost is
  identical either way** (fine-grained patch of only param-dependent bindings); the win is fewer
  requests and reads co-located with data.
- **The middleware chain = `src/app.ts` `export const middleware = [...]`** (FD1), running on
  **every server-touching request except static assets** (RPC and nav alike, §13.4 uniform
  auth). Each entry is onion middleware `(next) => Response` (`async (next) => { … return await
  next() }`, global wraps per-RPC wraps handler); `next()` takes no args (request via
  `request()`), so the passthrough is `next => next()`. A middleware can **observe** (log/trace)
  and **decide** — short-circuit by returning a `Response` (`redirect`/`error`). **Auth is just
  middleware**: a guard is a middleware that returns `error(403)` instead of calling `next`
  (arg-level checks read `route().params`). This partially un-parks `app.ts` — at least its
  per-request middleware chain is in this slice.

## C7. Two-way binding

1. **`bind:value={cell}` = sugar for `value={cell}` + `oninput={…}` writeback** (visible,
   no hidden magic; coerces by input type — number inputs → `number`). Event handlers use
   **native `on*` attributes** (`oninput`/`onchange`/`onclick`), not `on:event`. `<select>`
   and other change-driven elements use `onchange`.
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
   preservation); a **keyless `{#for}` dev-warns when its body has stateful bindings**
   (`bind:`, nested `<script>`, `bind:element`), since positional reuse can strand that state
   (prod unaffected). **Index `i` is reactive but wired only when referenced** — if the body
   doesn't use `i`, no index tracking (zero cost, the common case); when used, `i` updates on
   reorder/splice without remount (a head-splice's O(n) updates are correct-by-necessity but
   are signal writes only — keys preserve DOM identity, no reflow).
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
2. **Nested `<style>` = branch-subtree-scoped.**
3. **Root `<script>` = per-instance setup** (runs once per instance; fresh `state`; imports
   + functions). **`<script module>` = module-once** (shared constants/singletons, run once
   regardless of instance count) — **in scope**.
4. **Nested `<script>` = branch/iteration-local reactive state** — `state`/`computed`/
   `linked` created on branch mount, disposed on unmount, reusing root imports. In `{#for}`
   this is **per-item state**.
5. **Leaf directives:** `class:name={cond}` toggles a class reactively; `style:prop={val}`
   sets one style property reactively; `{html(expr)}` injects raw unescaped HTML (author
   owns XSS — all other `{expr}` is escaped by default); `{...expr}` spread (C4.4).

## C10. Type-checking & tooling (`abide check` / `abide lsp`)

A "type-safe template language" lives or dies here. The model reuses TypeScript, never a
bespoke checker.

1. **Type-checking = generate a TS representation of the `.abide` file, then check it with
   TypeScript 7** (the svelte-check model). The `.abide`→TS transform emits a typed module; TS7
   checks it; **errors map back to `.abide` source spans.** No custom type-checker.
2. **Every reactive expression is checked against real types** — `{user.naem}` → error;
   `attr={expr}`, `on*={fn}` (handler arg types), `bind:value` (element value type), `class:`/
   `style:`. Nothing is stringly-typed.
3. **Isomorphic type flow reaches templates (§6).** `{user(args)}` is typed against the RPC's
   input/output via the client-proxy type (§6.2, type-only import) — args checked, awaited value
   typed, **from the server handler's signature, zero manual annotation.**
4. **Cross-component prop checking.** `<Foo bar={x} />` checks `x` against `Foo`'s `props<T>()`;
   missing/extra/mismatched props error; snippet params (C4.3) and `bind:` props (C7.3) checked.
5. **Control-flow blocks preserve TS narrowing** — `{#if x}` narrows in-branch, `{#await}{:then
   v}` types `v`, `{#for item of list}` types `item`, `{:catch e}` types `e`, `{#switch}{:case}`
   narrows. The generated TS preserves flow narrowing.
6. **Generated `src/.abide/*.d.ts` drive typed routing** — route params (`[name]` →
   `route().params.name`), `url(path, args)` type-safe against the route tree, typed `navigate`
   targets — all from generated types keyed to the filesystem routes.
7. **`abide check` (batch/CI) and `abide lsp` (editor: diagnostics/completion/hover/go-to-def
   over stdio) share one core** — the `.abide`→TS transform + a TS language service. `check` is a
   one-shot run of what `lsp` does live.

---

## Deferred / parked (rule before implementation)

- **Lazy-mount island triggers** (`on-visible`/`on-idle`/`on-interaction`) — C2.
- **`src/app.ts`** beyond the per-request middleware chain (boot/shutdown hooks, `health()`,
  etc.) — only the request/nav middleware chain (`export const middleware = [...]`, FD1) is
  specced here (C6-nav).
- **Full socket API** (`tail`/`ttl`/`clientPublish`/`schema`/`clients`) — the multiplexer is
  the §8 broadcast channel; its authoring surface is a later slice.
- **`abide check`/`lsp` completion/hover/refactor UX depth** (C10 fixes the model — TS-service-
  backed diagnostics/completion/hover/go-to-def; polish and refactorings are unspecified).
- Cross-refs now specced elsewhere: `env(schema)` → `config-observability.md`; observability →
  same; desktop `bundle` → `bundle.md`; `compile`/`cli` → `machine-surfaces.md`/`build-pipeline.md`;
  OpenAPI/MCP → `machine-surfaces.md`.
- **Scroll restoration / `keepScroll` semantics** on nav — named in the API, mechanics not
  yet specced.
