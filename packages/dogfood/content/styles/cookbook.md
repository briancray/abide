---
title: Local state recipes (cookbook)
nav: Cookbook
intent: The local-state guide as a cookbook — each section a task, stated as Problem, Solution, Discussion.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — cookbook.** The O'Reilly *Cookbook* shape: **Problem**, **Solution**, **Discussion**,
> repeated. The reader arrives mid-task with a specific need, takes the solution, and reads the
> discussion only if the solution surprises them. Recipes are independent and deliberately
> overlap.

These recipes cover values a page owns and edits. Each one stands alone; take the one that matches
the task in front of you.

## Recipe: hold a value the page can edit

### Problem

You have something the page needs to keep — a text field, a toggle, a selection — and everything
on screen that shows it has to stay in step with it.

### Solution

Declare it with `state`, and read it by name:

```abide abide
<script>
import { state } from 'abide'

const handle = state('ada')
</script>

<h1>{handle}</h1>
<input bind:value={handle}>
```

### Discussion

Inside a `.abide` file, the name is the value. `handle` in an expression reads it, `handle = 'x'`
writes it, and `bind:value={handle}` does both. There is no listener to register and no re-render
to schedule — the heading read the value, so the heading follows the write.

Naming the state *without* using it in an expression is different: that hands over the value
itself, which is how you pass one to a component or a function.

`state` returns a `Reactive`, the same type `memo`, `channel` and every rpc handler return. So
probes, `await` and `tail` all work on a value the page merely owns; nothing has to be wrapped in
anything.

### See also

* [Local state](../values/show-a-value-that-changes.md)
* [Values by name](../templates/read-and-write-a-value-by-name.md)

## Recipe: normalise a value on the way in

### Problem

A visitor types `  Ada  ` and you want to store `ada`. You do not want every reader of the value
to remember to trim and lowercase it.

### Solution

Give the state a `transform`:

{% snippet local-state src/shared/profile.ts export const handle %}

### Discussion

`transform` runs before the value is stored, so every read downstream sees the clean one. Cleaning
at the point of *display* instead means every display site has to remember, and one of them will
not.

The transform runs untracked, on the settled value — never on a promise and never per chunk — so
it always sees whole values whatever produced them.

This is also where `Accepted` and `Stored` come apart. `Accepted` is what goes in, `Stored` is what
is kept and what a read returns. Without a transform they are the same type, which is why
`state<number>(0)` is the one type parameter it looks like.

A transform can also **refuse**: return a `Failed` and the write is rejected at the boundary
instead of being stored and checked later.

### See also

* [Form binding](../templates/bind-a-form-to-state.md)
* [Schemas](../server/check-what-callers-send-you.md)

## Recipe: refuse a bad value under your own name

### Problem

You want a rejected write to arrive as something your code can branch on — `notAnEmail`, not a
generic validation error.

### Solution

Refuse from the `transform` by returning a `Failed` you declared:

```ts browser
const email = state('', {
    transform: (value) =>
        value.includes('@') ? value.trim() : notAnEmail({ value }),
})
```

### Discussion

Both gates refuse, and what you refuse *with* decides which one to reach for.

A `schema` refuses as `ValidationError` carrying the validation issues, and it is nominally the
input gate. A `transform` refuses under a name the app declared, with data of its own attached,
and that is the only way to get one. So a check that wants a name is written as a transform even
though validation is the schema's job.

Either way the refusal fills `error()` rather than escaping as a throw, which is what a `bind:`
field reads through to show the message.

### See also

* [Failures](../server/refuse-a-request-and-say-why.md)

## Recipe: fill a state from the server

### Problem

The initial value comes from a database, and the page has to render before the row arrives.

### Solution

Hand the promise to `state`. Do not await it first:

{% snippet local-state src/shared/profile.ts export const profile %}

### Discussion

That is a `Reactive<User>`, not a `Reactive<Promise<User>>`. The state serves the **settled**
value, so a later write is `profile.set(edited)` with a plain `User` — nothing has to be wrapped
back up in a promise to match.

While the promise is in flight, `pending()` is true, the document goes out with a hole where the
name was, and the hole fills when the row lands.

The same rule applies at every write, not just at construction: `set` takes a settled value or a
load, and hands the load the same treatment.

One consequence worth knowing: a state given a load has a **producer**, so `refresh()` reloads it
and `ttl` reaches it. A state you only ever wrote a value into has neither, and those triggers do
nothing on it rather than discarding what you put there.

### See also

* [Loading states](../values/show-a-value-that-isnt-there-yet.md)
* [Reloading](../values/decide-when-a-value-reloads.md)

## Recipe: write to a state from a plain `.ts` file

### Problem

The logic belongs in a shared module, and a `.ts` file has none of the `.abide` sugar.

### Solution

Use the two members directly:

{% snippet local-state src/shared/profile.ts export function save %}

### Discussion

`s()` reads and `s.set(v)` writes. These are not a fallback or a lower-level API — they are what
the sugar is spelled over, and both keep compiling inside a `.abide` file too.

Putting shared state in `#shared` rather than in the page is what lets a handler, a test and a
second page all reach the same value without a context provider.

### See also

* [Sharing](../values/share-one-value-across-components.md)

## The whole thing, running

{% example local-state %}
