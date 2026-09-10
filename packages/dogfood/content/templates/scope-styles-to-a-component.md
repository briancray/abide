---
title: Scope styles to a component
nav: Styles
intent: CSS that applies here and nowhere else — and the app-wide stylesheet that does not.
covers:
  - `<style>`
  - `:global(…)`
  - `import './app.css'`
examples:
  - packages/dogfood/examples/style-scoped
  - packages/dogfood/examples/style-global
---

A component's styles are the component's. Writing `.badge` inside one and having it mean that
component's badge is the ordinary case, and it costs no naming convention, no build step of your
own and no BEM. The two things worth knowing are how the scoping is done, and how to leave it.

## The three ways CSS reaches a component

| You write | Reaches |
| --- | --- |
| `<style>` in the component | that component's own markup, and nothing else |
| `:global(…)` inside that block | whatever the compound matches, anywhere |
| `import './app.css'` from its `<script>` | the app, as an ordinary stylesheet dependency |

## The same class name in two components is two rules

{% example style-scoped %}

*2 components, 1 class name, 0 conventions* — against a name per component in every selector.

Every root element carries a **scope token** and every selector requires it on its rightmost
compound. So `.badge` compiles to "a `.badge` in this component", and a second component writing
the same rule is writing a different rule.

That is what makes the short name safe. The hand-written arm has to put the component's name into
the selector because nothing else will, and the cost is not the typing — it is that a third
component reusing `badge` has to already know the other two exist. A convention holds only as
long as everybody remembers it; the token is on the element whether anybody remembered or not.

A component scope the document never linked reaches the page through
`document.adoptedStyleSheets`, and there is **no fallback** for that. It is a platform feature the
supported browsers have, and a shim would be a second code path for styling that only ever ran
where nothing else did.

Read on: [Components](reuse-a-piece-of-markup.md)

## `:global(…)` is the per-selector escape

{% example style-global %}

`:global(…)` exempts the compound inside it from carrying the scope token, and that is the whole
of it. It is per **selector**, not per block, so a component's stylesheet can be scoped everywhere
except the one rule that genuinely is not — a reset it owns, a class on markup a parent handed it,
an animation another element runs.

It is the escape rather than the tool: a stylesheet made of `:global` rules is an app stylesheet
written in the wrong file, and the next section is where that belongs.

## An imported stylesheet is a dependency of the component

`import './app.css'` from any `<script>` in the file — or from any `.ts` that file reaches — makes
the stylesheet a dependency of that component. It is not scoped and is not meant to be — it is
the app's own CSS, arriving through the module graph rather than through a `<link>` you maintain
by hand. A component that needs it says so, and a page that never renders that component never
pays for it.

That is also why there is one mechanism here rather than two. A stylesheet is a module dependency
like any other, which is what lets the build know which routes need it without being told.

Read on: [Scripts](run-code-when-a-component-loads.md)

## Next

* [Components](reuse-a-piece-of-markup.md) — the boundary the scope is drawn around
* [Expressions](put-a-value-in-the-markup.md) — `class:name` and `style:prop` for the per-element case
* [View transitions](../pages/animate-from-one-page-to-the-next.md) — where a `<style>` rule turns a feature on
