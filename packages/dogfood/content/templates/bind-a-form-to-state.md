---
title: Bind a form to a value
nav: Form binding
intent: Inputs, checkboxes, radio groups and a details element, two-way with no handler.
covers:
  - `bind:value`
  - `bind:prop={state}`
  - `bind:checked`
  - `bind:open`
  - `bind:group`
  - `bind:value={{get, set}}`
examples:
  - packages/dogfood/examples/bind-text.json
  - packages/dogfood/examples/bind-boolean.json
  - packages/dogfood/examples/bind-branch.json
  - packages/dogfood/examples/bind-group.json
---

A form is a value you can see. The usual cost of saying so is a handler per field — read the
event, pull `target.value`, set the value, and remember to seed the input from the value on
the way back. `bind:` is that pair written once.

## A text input binds with `bind:value`

{% example bind-text %}

*2 lines, 1 direction each* — and no handler between them.

`bind:value` reads the property and writes back on `input` or `change`. The value is the single
copy — there is no separate form model to keep in step with it, and no submit handler needed to
find out what the fields hold. A `<textarea>` and a `<select>` take the same binding.

The hand-written arm is a listener **and** a seeding line per field, and the seeding half is the
one that gets forgotten: the page looks right until something other than the keyboard writes the
value.

Read on: [Local state](../values/show-a-value-that-changes.md)

## A checkbox and a `<details>` bind to a boolean

{% example bind-boolean %}

`bind:checked` is the boolean form. It mirrors a boolean DOM property as a boolean attribute
and **never stringifies it**, so a `false` is an absent attribute rather than the string
`"false"` — which makes `checked={false}` behave. It writes back on `change`.

`bind:open` is the same binding on a `<details>`, written back from its `toggle` event, so a
disclosure's open state is somewhere you can read rather than somewhere in the DOM.

{% snippet bind-boolean src/ui/components/Advanced.abide <details bind:open … <li><span>advanced %}

The readout reads `showAdvanced` like any other value, which is the point of binding it: the
disclosure is a value, so the rest of the page can branch on it.

## A bound value decides what renders

{% example bind-branch %}

`{#if billSeparately}` reads the bound value like any other read, so the field mounts when the box
is ticked and unmounts when it is cleared. There is no listener calling a second render and no
teardown for the field it built — the hand-written arm carries both.

What was typed into the address goes with it, the input being unbound. Bind it too where it has
to survive the box being cleared and ticked again.

## A radio group binds to one value, a checkbox set to an array

{% example bind-group %}

`bind:group` is membership rather than a value. Each input is compared against **its own
`value`**, and `group` is never emitted as an attribute — it is a binding, not something that
reaches the DOM.

```abide abide
<label>
    <input type="radio" bind:group={plan} value="monthly"> Monthly
</label>
<label>
    <input type="radio" bind:group={plan} value="yearly"> Yearly
</label>
```

Point several checkboxes at one array and the same binding collects them, each contributing
its own `value`.

```abide abide
<label>
    <input type="checkbox" bind:group={topics} value="releases"> Releases
</label>
<label>
    <input type="checkbox" bind:group={topics} value="security"> Security
</label>
```

Read on: [Conditionals](show-markup-conditionally.md) ·
[Lists](repeat-markup-over-a-list.md)

## `bind:` takes any writable `Reactive`

`bind:` needs somewhere to write. A value's name and a member path both qualify; an expression
does not, because `bind:value={price * 2}` has nothing to write back to.

Where the value you want is computed, hand over the pair explicitly:

```abide abide
<input bind:value={{ get: () => cents / 100, set: (v) => cents = v * 100 }}>
```

The accessor pair is the general form. Naming a value is the sugar over it.

A derived value is writable too, and where its body hands back another `Reactive` the write goes
through to that one (11.59). So `bind:value` over `reactive(() => users({ id: selected }))` edits
the shared `users({ id })` entry, and every other reader of that entry sees the edit.

## A `schema` refuses a value as it is written

A `schema` runs on the way into a value, and a write it refuses is rejected at the boundary
rather than stored and checked later:

```abide #ui/pages/account/page.abide — excerpt
<script>
import { reactive } from 'abide'
import { z } from 'zod'

const email = reactive<string>(undefined, { schema: z.string().email() })
</script>

<input bind:value={email}>
{#if email.error()}
    <p class="error">{email.error().data[0]}</p>
{/if}
```

`error()` hands back the failure **without throwing**, so a rejected field renders a message
rather than reaching `{#try}`. A schema refusal is a `ValidationError`, and on a primitive its
`data` is the list of messages.

The field opens empty. An opening `undefined` lands without passing the schema (4.16), so an
unfilled field is not a refusal.

**The field is not clobbered while you type.** A refused write does not move the stored value,
so nothing wakes the read-back side of the binding and the `f` you just typed stays where it is.
`error()` is a separate signal, so the message renders beside it. Two rules you already have,
doing the work between them.

`set` returns the refusal too, so a submit handler can act on it at the call site instead of
reading back.

## A `transform` refuses under a name you declared

Both gates refuse. What you refuse **with** picks between them: a schema refuses as
`ValidationError`, and a `transform` refuses as a name of your own — the only way a failure
arrives carrying data you chose. `refuse.named` declares it once and resolves on both sides, so
the same name serves a form field and a handler.

```ts #shared/failures.ts
import { refuse } from 'abide'
import { z } from 'zod'

export const notAnEmail = refuse.named('NotAnEmail', 422, undefined, {
    schema: z.object({ value: z.string() }),
})
```

```abide #ui/pages/account/page.abide — excerpt
<script>
import { reactive } from 'abide'
import { notAnEmail } from '#shared/failures'

const email = reactive(undefined, {
    transform: (value: string) =>
        value.includes('@') ? value : notAnEmail({ value }),
})
</script>

<input bind:value={email}>
{#if email.isError(email.error(), 'NotAnEmail')}
    <p class="error">{email.error().data.value} is not an email address.</p>
{/if}
```

No type argument is spelled: the refusal is typed onto `error()` from what the transform hands
back, and annotating its parameter says what the field takes.

`isError` narrows it by name, and `.data` is typed to what that failure declared — the same two
calls a page makes on a refused request. That is the reason to reach for it over a schema here:
`.data.value` is the rejected text, which a `ValidationError` does not carry.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Schemas](../server/check-what-callers-send-you.md)

## A component prop writes back to the caller with `bind:`

The call site decides this, not the child.

A prop is a **live read** of the caller's expression. `count={total}` tracks `total`,
`count={total * 2}` tracks it as a derived read, and neither reinstantiates the component. The
child declares the prop as the type of its value and writes it by name:

```abide #ui/components/Stepper.abide
<script>
import { props } from 'abide'

const { count } = props<{ count: number }>()
</script>

<button onclick={() => count += 1}>{count}</button>
```

Put `bind:` on the tag and the write goes to the caller's value:

```abide abide
<Stepper bind:count={total}/>
```

Leave `bind:` off and the write stays in the child until the caller's expression changes. The
same `Stepper` then works bound and unbound, and a reader sees which one it is at the call site
without opening the child.

On a component, `bind:` takes the name of a reactive value, or a `{get, set}` pair as an input
does. `bind:count={total * 2}` has nothing to write to, and the checker says so.

Read on: [Components](reuse-a-piece-of-markup.md)

## Next

* [Events](respond-to-a-click.md) — when you actually want a handler
* [Local state](../values/show-a-value-that-changes.md) — the thing being bound
* [Schemas](../server/check-what-callers-send-you.md) — checking a body at the boundary
