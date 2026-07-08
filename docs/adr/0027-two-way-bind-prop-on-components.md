# ADR-0027: Two-way `bind:prop` on components is usage-inferred, not declared

**Status:** proposed (2026-07-08). Extends the element two-way bind
(`bind:value`/`bind:checked`/…) to child components, reusing the accessor contract
in `lowerContext` (`bindRead`/`bindWrite`) and the prop pipeline
(`composeProps` → `props()` desugaring). Touches the shadow from
[ADR-0010](0010-template-type-checking-via-virtual-shadow.md).

## Context

`bind:attr={target}` on a native element is a two-way binding: a `$$watch` drives the
DOM property from `target`, and a listener writes it back on the property's native
event. Components had no equivalent — `bind:value={x}` on `<Child>` silently compiled
to a dead prop keyed `"bind:value"` that no child ever read. Authors wanting a child
to push a value up had to hand-roll a `value={x}` prop plus an `onchange={v => x = v}`
callback and keep the two in sync.

The element model works because a DOM node *has* a writable property. A component's
props, by contrast, are delivered as read-only value thunks (`$props[key]?.()`) and
consumed as read-only derives — there is no child→parent write path at all. So a real
two-way `bind:prop` needs a channel the child can write through, and a decision about
how the child opts into writing.

The design space forked on the child side:

- **Explicit marker** (Svelte's `$bindable()`): the child declares a prop bindable, so
  two-wayness is statically visible on both sides and checkable. Costs a new
  child-facing primitive.
- **Implicit, usage-inferred**: the child writes or forwards the prop as an ordinary
  variable and the compiler infers the upgrade. No new surface; two-wayness is dynamic.

The project bias is a small, standards-shaped, low-ceremony surface. The element bind
already carries no element-side marker — the parent binds, the element just has a
writable property — so the symmetric choice for components is *no child-side marker*.

## Decision

**Bindability is inferred from how the child uses the prop; there is no child-side
declaration.**

Parent side. `bind:prop={target}` becomes a prop under its **bare** name (`value`, not
`bind:value`) carrying a write-back channel: `bindProp(() => bindRead(target), $v => bindWrite(target, $v))`.
`bindProp` annotates the ordinary value thunk with a `set` — a read-only consumer still
just calls the thunk, so `restProps`/`mergeProps`/`spreadProps` pass it through
untouched. `target` accepts the same forms an element bind does (an lvalue, or a
`{ get, set }` accessor), because it flows through the same `bindRead`/`bindWrite`.

Child side. The compiler scans the script *and* the template (event expressions,
`bind:` targets) for writes to each prop name. A prop that is only read stays a cheap
read-only derive (unchanged). A prop that is **written or forwarded** is upgraded to a
writable `.value` cell via `bindableProp`, which decides at construction from what the
parent passed:

- **Bound** (the thunk carries `set`) → a pure pass-through accessor: reads pull the
  parent's value (tracking its reactive source), writes go straight upstream. The
  parent's target is the single source of truth; no local copy.
- **Unbound** (a plain thunk, or the prop was never passed) → a local `linked` cell
  seeded from the parent value: it reseeds on parent change and holds local writes in
  between, so the component still works standalone.

Type-checking. A component `bind:prop` is checked as an ordinary data prop — its target
type-checks against the child's declared `prop`, satisfies it if required, and flags
excess if the child has no such prop. The shadow emits the `props()` destructure as
`let` rather than `const` so a written-back prop is not a spurious const-assignment;
since bindability is dynamic, the shadow relaxes the whole destructure rather than
singling out written props.

## Consequences

- **Zero child ceremony.** `<Child bind:value={count} />` on the parent; `const { value } = props()`
  then `value += 1` or `<input bind:value={value} />` in the child. No `.value`, no
  marker, no accessor in author code.
- **The common case is unchanged and cheap.** A read-only prop compiles exactly as
  before; only written/forwarded props pay for the writable cell.
- **Bindability is not statically enforced.** Forget `bind:` on the parent and the
  child's writes silently stay local instead of erroring — the price of no child-side
  marker. The compile-time read-only-prop guard is given up for props.
- **`bind:` does not survive `{...spread}`.** A spread re-wraps each key in a fresh
  value thunk, dropping the `set`; a prop forwarded through `{...rest}` is read-only
  downstream. Acceptable — spread is a bulk forward, `bind:` is a named channel.
