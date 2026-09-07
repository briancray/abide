---
title: Build an editable profile (tutorial)
nav: Tutorial
intent: The local-state guide as a hands-on tutorial — numbered steps, one path, a guaranteed result.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — tutorial (Diátaxis).** Learning-oriented. The reader is a beginner being taken
> somewhere, so there is one path and no alternatives, every step produces something visible, and
> nothing is explained beyond what the next step needs. Completeness is not the goal; a first
> success is.

In this tutorial you will build a profile page that loads a name from the server, lets a visitor
edit their handle, and saves the change. Along the way you will meet `state`, the reactive value
every abide page is built from.

You will write about twenty-five lines. It should take ten minutes.

## What you will need

* abide installed, and a project created with `abide new`.
* A terminal running `abide dev`.
* Any text editor.

You do not need to know how reactivity works. That is what you are about to see.

## Step 1 — Create the page

Create the file `src/ui/pages/profile/page.abide` and put a heading in it:

```abide abide
<h1>Profile</h1>
```

Open `http://localhost:3000/profile`. You should see the word **Profile**.

That is a route. The folder made it, and there was nothing to register.

## Step 2 — Hold a value

Add a `<script>` block above the heading and declare a value:

```abide abide
<script>
import { state } from 'abide'

const handle = state('ada')
</script>

<h1>Profile</h1>
```

Nothing changed on screen yet. You now have a value the page owns.

## Step 3 — Put the value on the page

Change the heading so it shows the handle:

```abide abide
<h1>{handle}</h1>
```

Reload the page. You should see **ada**.

Notice what you wrote: `handle`, not `handle.get()` or `handle.value`. Inside a `.abide` file the
name *is* the value.

## Step 4 — Let the visitor type

Add an input below the heading and bind it to the same value:

{% snippet local-state src/ui/pages/profile/page.abide <label> %}

Type in the box. The heading follows every keystroke.

Stop for a moment, because this is the whole idea of the framework: you did not add an event
listener, you did not write a setter, and you did not tell anything to re-render. `bind:value`
reads the value and writes it, and the heading had read the same value, so the heading updates.

## Step 5 — Normalise what gets typed

A handle should not have spaces or capitals in it. Move the value into a shared file,
`src/shared/profile.ts`, and give it a `transform`:

{% snippet local-state src/shared/profile.ts export const handle %}

Import it in your page instead of declaring it there:

```abide abide
<script>
import { handle } from '#shared/profile'
</script>
```

Now type `  Ada  ` into the box, with the spaces and the capital. The heading shows `ada`.

The transform runs on the way *in*, so what is stored is already clean. Nothing downstream has to
remember to tidy it up.

## Step 6 — Load the name from the server

Add a handler in `src/server/rpc/users.ts`:

{% snippet local-state src/server/rpc/users.ts export const getProfile %}

Then give a second state that handler's result, in the same shared file:

{% snippet local-state src/shared/profile.ts export const profile %}

And show the name in the heading:

{% snippet local-state src/ui/pages/profile/page.abide <h1> %}

Reload. You should see **Ada Lovelace**.

You did not write a fetch, a route, a loading flag or a type. You called the handler and read the
result.

## Step 7 — Save the edit

Add a function that writes the edited handle back into the profile:

{% snippet local-state src/shared/profile.ts export function save %}

And a button that calls it:

{% snippet local-state src/ui/pages/profile/page.abide <button onclick= %}

This is a `.ts` file, so it spells the read and the write out: `profile()` reads, `profile.set(…)`
writes. Those are the same two members your page reached by name. The sugar in a `.abide` file
sits over them; it does not replace them.

Type a new handle and press **Save**. The heading follows.

## What you built

{% example local-state %}

A page that loads from the server, edits on the client, normalises on the way in, and saves — in
twenty-seven lines, with no event listeners and no re-render calls.

## What you learned

* `state(initial)` holds a value the page owns.
* Inside a `.abide` file, the name is the value: reading it in an expression reads it, and
  assigning to it writes it.
* `bind:value` does both at once.
* A `transform` shapes a value on the way in.
* Giving a state a promise makes it load, and reading it is all it takes to show the result.

## Next steps

Now that you have something working, go and find out how it works:

* [Local state](../values/show-a-value-that-changes.md) — the same ground, explained rather than walked
* [Loading states](../values/show-a-value-that-isnt-there-yet.md) — what to show before the row lands
* [Form binding](../templates/bind-a-form-to-state.md) — the rest of what `bind:` does
