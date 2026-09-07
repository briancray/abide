---
title: state — README quickstart
nav: README quickstart
intent: The local-state guide as a package README — code first, prose only where the code is not obvious.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — README quickstart.** The shape a package README has: install, one working snippet
> above the fold, a short API list, a gotchas section, links out. Optimised for time-to-first-line,
> and it explains nothing it can show instead.

Reactive values a page owns.

```abide abide
<script>
import { state } from 'abide'

const handle = state('ada')
</script>

<h1>{handle}</h1>
<input bind:value={handle}>
```

The heading follows the input. No listener, no setter, no re-render.

## Quick reference

| You write | You get |
| --- | --- |
| `state()` | `Reactive<undefined>`, already settled |
| `state(v)` | holds `v` |
| `state(promise)` | loads — `pending()` until it settles, then holds the settled value |
| `state(v, { transform })` | shapes `v` on the way in |
| `state(v, { schema })` | validates `v` on the way in |
| `handle` *(in `.abide`)* | read |
| `handle = 'x'` *(in `.abide`)* | write |
| `bind:value={handle}` | both |
| `handle()` | read, anywhere |
| `handle.set('x')` | write, anywhere |

## Normalise on the way in

{% snippet local-state src/shared/profile.ts export const handle %}

Runs before storage, untracked, on settled values only. Return a `Failed` to refuse the write.

## Load from the server

{% snippet local-state src/shared/profile.ts export const profile %}

`Reactive<User>`, not `Reactive<Promise<User>>`. Read it and it renders when it lands.

## Write from a `.ts` file

{% snippet local-state src/shared/profile.ts export function save %}

## Gotchas

* **Naming a state does not read it.** In an expression it reads; alone it hands over the
  `Reactive`. Passing one to a component is the second thing.
* **A transform is not the validator** — `schema` is. Use `transform` when you want the refusal to
  carry a name you declared.
* **Refreshing does nothing on a plain state** — no producer, nothing to fetch. Give it a promise
  or a `store` and the triggers come alive.
* **Accepted and Stored are two types** — the same one until you add a `transform`.
* **A state with no argument is settled, not pending** — nothing loads, so no `{#await}` branch
  is left unmatched.

## Full example

{% example local-state %}

## Docs

* [Local state](../values/show-a-value-that-changes.md)
* [Loading states](../values/show-a-value-that-isnt-there-yet.md)
* [Reactive](../reference/reactive.md)
