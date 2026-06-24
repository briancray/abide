# Slot-presence via a `children` prop

**Date:** 2026-06-24
**Status:** Approved — ready for implementation plan

## Problem

A component's `<slot></slot>` already renders parent-supplied content, falling back to
its own default content (`<slot>fallback</slot>`) when none was passed. But that
fallback only fires *at the slot's own position*. There is no author-facing way to
test whether slot content was passed, so a component cannot render **chrome around**
a slot conditionally — e.g. emit a `<footer>` wrapper *only* when footer content
exists. An empty slot still produces the wrapper.

We need a value an author can put in `{#if …}` so an empty slot emits **nothing** —
not even its wrapper.

## Scope

**In scope (presence only):**

- Expose passed default-slot content to the component as a typed prop named
  `children` (a `Snippet`).
- `{#if children}` tests presence; `{children}` renders it (no fallback);
  `<slot/>` is unchanged.

**Out of scope (deliberate non-goals):**

- **Generic components / typed slot payloads.** Passing a typed payload into a slot
  (render-prop / `let:item` pattern, `<List row={rowSnippet}/>` where `item`'s type
  flows parent↔child) requires a free type parameter and parent-side
  `Parameters<…>` instantiation. That is a separate future spec.
- **Named slots** (`<slot name="footer"/>`, `slot="footer"`). Documented in examples,
  not implemented; not part of this work. The design should not preclude them
  (`children` generalises to `header`/`footer` later).
- **Validating passed slot content against the child's `children` type.** Slot
  content is consume-side-typed only (see Typing).
- **Erroring when content is passed to a slotless component.** Current behaviour
  (silently dropped via `restProps` filtering `$children`) is unchanged.

## Author surface

`children` is a regular, typed prop — always present on the props shape, no
declaration needed. Destructure it in `<script>` and use the binding in the template:

```html
<script>
  const { title, children } = props<{ title: string }>()
</script>
<article>
  <h2>{title}</h2>
  {#if children}
    <footer class="card-foot">{children}</footer>
  {/if}
</article>
```

- `{#if children}` — presence test (truthy when the parent passed content).
- `{children}` — renders the passed content, **no fallback**.
- `<slot/>` — unchanged; still sugar for "render passed content, else fallback".

Empty slot ⇒ `{#if children}` is false ⇒ the `<footer>` chrome is never emitted.

**Access path:** `props()` is a script-only desugar, so access is via the destructured
binding (`const { children } = props()`), not inline `{props().children}` in template
expressions — the same rule as every other prop.

**Reserved name:** `children` is reserved for default-slot content. A literal
`children={…}` attribute is not a supported way to pass it (slot content arrives as
nested DOM, wired to `$children`).

## Typing (shadow only)

The `props` stub gains `children`:

```ts
declare function props<T = Record<string, any>>(): Omit<T, 'children'> & { children?: Snippet }
```

- `children` types as `Snippet | undefined` regardless of `T`, available even on a
  bare `props()`.
- `Omit<T, 'children'>` avoids the `Record<string, any>` index signature swallowing
  the explicit type. The exact intersection form is verified under test (TS
  resolution of `any &` / index-signature precedence is subtle).

`Snippet` gains a default payload param so the erased form reads cleanly:

```ts
// shared/snippet.ts
export type Snippet<Payload = unknown> = { readonly [SNIPPET]: Payload }
```

**Consume-side-typed only.** The shadow checks a child mount per *explicitly-passed
attribute* via `Parameters<typeof Child>[0]["name"]` (`compileShadow.ts:368`). Nested
content inside `<Card>…</Card>` does **not** go through that path — it is emitted via
`emitNodes` in the *parent's* scope (`compileShadow.ts:374`) and wired to `$children`
by the compiler. So:

- `children?: Snippet` exists purely so the **child** can read/test/render it.
- The **parent** never passes `children` as a checkable value; nested content is
  structurally renderable DOM, already type-checked in the parent's own scope. No new
  parent-side check is added. `children` being reserved and never explicitly passed is
  what keeps `Parameters<…>["children"]` from ever firing.

## Compiler + runtime

- **Desugar** (`desugarSignals.ts`): the destructured `children` binding is
  special-cased. Instead of the normal
  `scope().derive("children", () => $props["children"]?.())`, it lowers to a one-time
  const wrapping the existing builder as a snippet:

  ```js
  const children = $props && $props.$children ? snippet($props.$children) : undefined
  ```

  `$children` is mount-constant, so a plain `const` (no `derive`) is correct.
  `snippet` is added to the runtime imports if not already present.

- **Rendering `{children}`**: routes through the existing snippet-interpolation path
  (`snippetPayload` → mount). Implementation must confirm `{children}` mounts with the
  **same marker/scope semantics as `mountSlot`** so reactive parent-supplied content
  updates and disposes correctly — likely `{children}` should reuse `mountSlot`
  internally rather than the generic snippet append. **Verify under TDD.**

- `<slot/>` codegen is untouched. `<slot/>` (with fallback) and `{children}` (no
  fallback) coexist.

## SSR + hydration

`{#if children}` is a **constant** condition — `children` is mount-fixed and identical
on server and client (the parent either passed content or did not, the same on both
sides). The chosen branch is therefore deterministic across SSR and hydrate: no
flicker, no congruence drift. A test must still prove the conditional-chrome component
hydrates clean (this is the index-drift-prone marker-range territory).

## Testing (TDD)

1. `children` is truthy when content was passed, `undefined` when not.
2. `{children}` renders the passed content.
3. **Empty slot ⇒ wrapper element absent** (the core case).
4. `<slot>fallback</slot>` fallback still works alongside `children`.
5. SSR + hydrate congruence for the conditional-chrome component (no drift/flicker).
6. Shadow: `children` types as `Snippet | undefined` and coexists with
   `props<{…}>()`; the `Omit` intersection resolves to `Snippet | undefined` (not
   `any`).
7. Reserved-name: a parent spreading `{...obj}` carrying a `children` key does not leak
   in as slot content (mirrors the existing `$children`-filter test).

## Affected files (initial map)

- `packages/abide/src/lib/shared/snippet.ts` — default payload param.
- `packages/abide/src/lib/ui/compile/compileShadow.ts` — `props` stub adds `children`.
- `packages/abide/src/lib/ui/compile/desugarSignals.ts` — special-case `children`
  binding.
- `packages/abide/src/lib/ui/compile/UI_RUNTIME_IMPORTS.ts` — ensure `snippet` import
  available where `{children}` / the desugar emit it.
- Possibly `packages/abide/src/lib/ui/dom/` — `{children}` reusing `mountSlot`.
- `packages/abide/tests/` — new test file (e.g. `uiSlotPresence.test.ts`).
- Docs/grammar (`AGENTS.md`) updated to document `children` after implementation.
