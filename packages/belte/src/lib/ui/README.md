# belte-ui

A from-scratch, single-file UI framework for belte — reactive, with `<script>` +
template + `<style>` in one `.belte` file. No Svelte. Signal surface, document
substrate, server-rendered and streamed, with true DOM adoption.

Status: exploration on branch `belte-ui-wt`. Not wired into belte's own page
server; the runnable proof is `examples/belte-ui-demo` (Bun.build + Bun.serve).

## A component

```html
<script>
  import Layout from './Layout.belte'
  let count = state(0)              // signal
  let items = state([])
  let total = derived(() => items.length)   // computed
  function add() { items.push('item ' + (total + 1)) }
</script>

<Layout title="home">
  <button onclick={() => count += 1}>count: {count}</button>
  <button onclick={add}>add ({total})</button>
  <template if={total}>
    <ul>
      <template each={items} as="it" key="it"><li>{it}</li></template>
    </ul>
    <template else><p>empty</p></template>
  </template>
</Layout>

<style>
  button { cursor: pointer }   /* scoped to this component */
</style>
```

## Idioms

- **Signals are the surface**: `state(v)`, `derived(fn)`, `effect(fn)`, `prop(name)`.
  You write plain assignment (`count += 1`, `items.push(x)`); the compiler lowers
  it. Templates auto-read (`{count}`); ordering and cross-references compose.
- **Everything dynamic lives in `{ }`** — `{expr}` text, `name={expr}`,
  `onclick={fn}`, `bind:value={path}`.
- **Control flow is native `<template>`** (valid HTML, no mustache DSL):
  `<template if>`/`<template else>`, `<template each as key>`,
  `<template await>`/`then`/`catch`, `<template switch>`/`case`/`default`.
- **Components** are capitalised tags (`<Layout title="…">`); children fill the
  child's `<slot>`. Props are reactive (passed as thunks).
- **Scoped styles**: a `<style>` block is scoped per component via a
  `[data-b-<hash>]` attribute.

## Substrate (why it's fast)

State is one mutable document addressed by path; every change is a patch over a
path. The compiler turns `model.a[i].b` into a path read and `model.x = y` into a
patch, hoisting static paths to a `cell` resolved once. Reactivity is shape-only
(a deep field edit wakes only that field, not the list above it). On the
write-path microbench this runs ~20× faster than Svelte 5 `$state`.

## SSR + streaming + hydration

- `compileSSR` renders to an HTML string (byte-identical to the client DOM).
- `renderToStream` streams: pending shell first, then resolved `<template await>`
  fragments out of order as their promises settle; `applyResolved` swaps them in.
- `hydrate` adopts the server DOM in place (no re-render) for static-structure
  components — claims existing nodes, splits merged text, wires effects/listeners.

## Pipeline

```
.belte → analyzeComponent (split script/style/template, desugar signals → doc,
                           lower data access, scope CSS)
       → generateBuild  (client: openChild/appendText/attr/on/each/when/…)
       → generateSSR    (server: HTML-string back-end, await markers)
       → hoistCells     (static paths → cells)
       → compileModule  (ES module: default mount + render() for SSR)
```

`compile/belteUiPlugin.ts` is the Bun loader for `.belte` files.

## Known gaps

- Hydration adopts static structure only; control-flow blocks (if/each/await/
  switch) and child components fall back to `mount` (re-render).
- `compileModule` emits `belte/ui/*` specifiers (a published consumer needs
  `@belte/belte/ui/*` or `belteImportName`); the demo bridges via a build resolver.
- Not integrated into belte's own (Svelte-based) page server.
- Data fetching uses plain `fetch`, not belte `cache()` (no dedup/SSR-snapshot yet).
