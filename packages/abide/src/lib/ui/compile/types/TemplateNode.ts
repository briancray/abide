import type { TemplateAttr } from './TemplateAttr.ts'
import type { TextPart } from './TextPart.ts'

/*
A parsed template node. `text` carries interpolation parts; `element` carries
attributes and children; `each` is the `{#for items as item}` control flow over a
list; `if`/`await`/`switch`/`try` are its control-flow siblings.

`loc` (where present) is the absolute offset of the node's primary expression in
the original `.abide` source — additive, set only when the parser tracks
positions for the type-checking shadow, ignored by the runtime back-ends.
*/
export type TemplateNode =
    | { kind: 'text'; parts: TextPart[] }
    | { kind: 'script'; code: string; loc?: number }
    /* A `<style>` declared in the template. `css` is its raw body, read structurally
       so a `<style>` inside an expression isn't mistaken for one. The node stays in
       place: it scopes its sibling subtree, so the front-end derives each scope
       attribute and the elements it covers from the node's position (see
       `analyzeComponent`). Emits no DOM/markup. */
    | { kind: 'style'; css: string }
    | {
          kind: 'element'
          tag: string
          attrs: TemplateAttr[]
          children: TemplateNode[]
          /* The scope attributes (`data-a-…`) this element carries — one per `<style>`
             active at its position (its own sibling list plus every ancestor's),
             filled by `analyzeComponent`. Absent until annotated. */
          scopes?: string[]
      }
    | {
          kind: 'each'
          items: string
          as: string
          key: string | undefined
          /* `index="i"` → the row's reactive position, bound to this name; absent → unbound. */
          index: string | undefined
          /* `await` on the tag → `items` is an AsyncIterable, drained on the client. */
          async: boolean
          children: TemplateNode[]
          loc?: number
          /* Source offsets of the binding name, `by` key, and index — so the shadow
             maps hover/highlighting onto them (absent for synthesised/missing parts). */
          asLoc?: number
          keyLoc?: number
          indexLoc?: number
      }
    | { kind: 'if'; condition: string; children: TemplateNode[]; loc?: number }
    | {
          kind: 'await'
          promise: string
          /* `then` in the await head (`{#await p then v}`) makes the block BLOCKING:
             no pending branch, children are the resolved content bound to `as`, SSR
             settles before the first flush. Absent → streaming. */
          blocking: boolean
          as: string | undefined
          children: TemplateNode[]
          loc?: number
          /* Source offset of an inline blocking `then` binding (`{#await p then v}`). */
          asLoc?: number
      }
    | { kind: 'try'; children: TemplateNode[] }
    | {
          kind: 'branch'
          branch: 'then' | 'catch' | 'finally'
          as: string | undefined
          children: TemplateNode[]
          /* Source offset of the `then`/`catch` binding, so the shadow maps it. */
          asLoc?: number
      }
    | {
          kind: 'component'
          name: string
          /* Source offset of the tag name — the anchor for a whole-mount diagnostic
             (a missing required prop, which has no supplied expression to point at). */
          loc?: number
          /* Each authored attribute as a prop. A `spread` entry (`{...code}`) carries no
             `name`; its keys merge in at runtime (`mergeProps`/`spreadProps`). `nameLoc` is
             the prop name's source offset — the anchor for an excess-prop diagnostic. `bind`
             marks a `bind:<name>={target}` two-way prop: `code` is the writable target (an
             lvalue or a `{ get, set }` accessor), passed with a write-back channel so the
             child can push changes upstream (`bindProp`/`bindableProp`). */
          props: {
              name: string
              code: string
              loc?: number
              nameLoc?: number
              spread?: boolean
              bind?: true
          }[]
          children: TemplateNode[]
      }
    | { kind: 'switch'; subject: string; children: TemplateNode[]; loc?: number }
    /* A branch of a `<template switch>` (`match` set) or `<template if>` chain. Inside an
       `if`, `<template elseif={c}>` sets `condition` (match-less, truthy-tested), and
       `<template else>` leaves both unset (the default). `loc` points at whichever
       expression the node carries (`match` or `condition`). */
    | {
          kind: 'case'
          match: string | undefined
          condition?: string
          children: TemplateNode[]
          loc?: number
      }
    /* A `{#snippet row(item)}` snippet: a named, scope-capturing builder declared
       once and called like a function (`{row(item)}`). `params` is the raw
       parameter list from the parens (absent when there are no parameters). */
    | {
          kind: 'snippet'
          name: string
          params: string | undefined
          children: TemplateNode[]
          loc?: number
      }
