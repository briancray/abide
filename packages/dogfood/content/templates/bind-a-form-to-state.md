---
title: Bind a form to state
nav: Form binding
intent: Inputs, checkboxes, radio groups and a details element, two-way with no handler.
covers:
  - `bind:value`
  - `bind:prop={state}`
  - `bind:checked`
  - `bind:open`
  - `bind:group`
  - `bind:value={{get, set}}`
  - state › `transform`
---

A form is state you can see. The usual cost of saying so is a handler per field — read the
event, pull `target.value`, set the state, and remember to seed the input from the state on
the way back. `bind:` is that pair written once.

```abide #ui/pages/account/page.abide
<script>
import { state } from 'abide'

const name = state('')
</script>

<input bind:value={name}>
<p>Hello {name}</p>
```

Two lines, one direction each, and no handler between them.

## Binding a text input

`bind:value` reads the property and writes back on `input` or `change`. The state is the
single copy — there is no separate form model to keep in step with it, and no submit handler
needed to find out what the fields hold.

```abide
<input bind:value={email}>
<textarea bind:value={notes}></textarea>
<select bind:value={plan}>
    <option value="monthly">Monthly</option>
    <option value="yearly">Yearly</option>
</select>
```

Read on: [Local state](../values/show-a-value-that-changes.md)

## Binding a checkbox or a details element

`bind:checked` is the boolean form. It mirrors a boolean DOM property as a boolean attribute
and **never stringifies it**, so a `false` is an absent attribute rather than the string
`"false"` — which is what makes `checked={false}` behave. It writes back on `change`.

`bind:open` is the same binding on a `<details>`, written back from its `toggle` event, so a
disclosure's open state is somewhere you can read rather than somewhere in the DOM.

```abide
<label><input type="checkbox" bind:checked={subscribed}> Email me</label>

<details bind:open={showAdvanced}>
    <summary>Advanced</summary>
    <input bind:value={endpoint}>
</details>

{#if showAdvanced}<p class="hint">These apply on save.</p>{/if}
```

The `{#if}` reads `showAdvanced` like any other value, which is the point of binding it: the
disclosure is state, so the rest of the page can branch on it.

## Binding a radio group or a set of checkboxes

`bind:group` is membership rather than a value. Each input is compared against **its own
`value`**, and `group` is never emitted as an attribute — it is a binding, not something that
reaches the DOM.

```abide
<label><input type="radio" bind:group={plan} value="monthly"> Monthly</label>
<label><input type="radio" bind:group={plan} value="yearly"> Yearly</label>
```

Point several checkboxes at one array and the same binding collects them, each contributing
its own `value`.

```abide
<label><input type="checkbox" bind:group={topics} value="releases"> Releases</label>
<label><input type="checkbox" bind:group={topics} value="security"> Security</label>
```

Read on: [Conditionals](show-markup-conditionally.md) ·
[Lists](repeat-markup-over-a-list.md)

## Binding to something that is not a state

`bind:` needs somewhere to write. A state name and a member path both qualify; an expression
does not, because `bind:value={price * 2}` has nothing to write back to.

Where the value you want is computed, hand over the pair explicitly:

```abide
<input bind:value={{ get: () => cents / 100, set: (v) => cents = v * 100 }}>
```

The accessor pair is the general form. Naming a state is the sugar over it.

## Refusing a value as it is written

A `transform` runs on the way into a state, and it may **refuse** — return a `Failed` and the
write is rejected rather than stored and checked later. `refuse.typed` declares the failure
once, and resolves on both sides, so the same name serves a form field and a handler.

```ts #shared/failures.ts
import { refuse } from 'abide'

export const notAnEmail = refuse.typed('NotAnEmail', 422)
```

```abide #ui/pages/account/page.abide
<script>
import { state } from 'abide'
import { notAnEmail } from '#shared/failures'

const email = state('', {
    transform: (value) => (value.includes('@') ? value : notAnEmail({ value })),
})
</script>

<input bind:value={email}>
{#if email.isError(email.error(), 'NotAnEmail')}
    <p class="error">{email.error().data.value} is not an email address.</p>
{/if}
```

`error()` hands back the failure **without throwing**, so a rejected field renders a message
rather than reaching `{#try}`. `isError` narrows it by name, and `.data` is typed to what that
failure declared — the same two calls a page makes on a refused request.

`set` returns the refusal too, so a submit handler can act on it at the call site instead of
reading back.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Schemas](../server/check-what-callers-send-you.md)

## When a component prop needs `bind:`

The child decides this, not the call site.

A prop declared as a plain `T` is a **live read** of the caller's expression. `count={total}`
tracks `total`, `count={total * 2}` tracks it as a derived read, and neither reinstantiates the
component. There is nothing behind it to write to — so there is no binding to add, and
`bind:count={total * 2}` has nothing to bind.

A child that wants the write path declares the prop as a `Reactive` instead:

```abide #ui/components/Stepper.abide
<script>
import { props, type Reactive } from 'abide'

type Props = { count: Reactive<number> }

const { count } = props<Props>()
</script>

<button onclick={() => count += 1}>{count}</button>
```

That declaration makes `bind:` a **compile requirement** at every call site — not a runtime
warning, and not something the component discovers about how it was called:

```abide
<Stepper bind:count={total}/>
```

Leave the `bind:` off and it does not compile. The marker sits at the call site on purpose:
that is the side giving write access up, so a reader sees it without opening the child, while
the child's declaration is what lets the compiler check every caller.

`bind:` needs the same lvalue a native binding does — a state name, a member path, or a
`{get, set}` pair.

Read on: [Components](reuse-a-piece-of-markup.md)


## Next

* [Events](respond-to-a-click.md) — when a handler is what you actually want
* [Local state](../values/show-a-value-that-changes.md) — the thing being bound
* [Schemas](../server/check-what-callers-send-you.md) — checking a body at the boundary
