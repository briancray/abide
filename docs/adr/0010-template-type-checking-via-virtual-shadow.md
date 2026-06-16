# ADR-0010: template type-checking via a virtual TS shadow

**Status:** accepted (2026-06-16)

## Context

abide already has genuine end-to-end typing at three boundaries: RPC args/return
(the client imports the server module at the type level — `typeof import(...)` —
while the bundler swaps the runtime), `page.params` (`writeRoutesDts` augments a
`Routes` discriminated union), and `health()` (`writeHealthDts` reads the app's
hook return). All three are derived from the user's own code, not hand-mirrored.

The `.abide` template layer is the gap. Two facts make it so:

1. **The authored `<script>` is a sugar dialect, not valid TS.** `prop` has no
   runtime export — it is a compile-only token `desugarSignals` recognises.
   `state<T>`/`derived<T>` *do* exist but return `State<T>`/`Derived<T>` (a
   `.value` accessor), yet the author writes `let count = state(0); count += 1`
   and `{count}`, treating them as bare unwrapped values. `count += 1` on a
   `State<number>` is a type error; it only becomes valid after `renameSignalRefs`
   + `lowerDocAccess` rewrite it to `model.replace('count', model.read('count') + 1)`
   — and `model` is `doc({})`, untyped. So the script cannot simply be re-emitted
   into a checkable file.

2. **Template expressions are extracted as strings and emitted into JS.** Each
   `{expr}` becomes `appendText(host, () => (<lowered expr>))` in a module the
   `.abide` loader emits as `loader: 'js'`, never handed to `tsc`. A typo in
   `{user.naem}` or a wrong prop on `<Child x={42}/>` is never caught.

This is exactly the problem `svelte2tsx` + `svelte-check` solve for Svelte:
synthesise a typed shadow that reconstructs the author-facing scope with *value*
types, then run the type checker over the shadow and map diagnostics back.

## Decision

A pure `compileShadow(source) → { code, mappings }` plus a custom TypeScript host
that serves the shadow as a **virtual `.ts` at the source file's own path**. No
shadow files are written to disk.

### Why virtual, not written

Writing `Foo.abide.ts` next to sources clutters the tree and shows in the editor;
writing into `src/.abide/shadows/**` breaks the relative and alias imports inside
the component. A virtual file *at the source path* makes every `import` resolve
exactly as it does for the real module, and is the representation an LSP needs
anyway — so the `abide check` CLI and the language server share one core.

### The shadow shape

`compileShadow` rewrites the script's signal surface to value types and harvests
every template expression into a checkable function body:

```ts
import Child from './Child.abide'            // hoisted imports, verbatim
export interface Props { title: string; lang?: string }
export default function (props: Props): void {
    let count = (0)                          // from state(0)        → number
    let title: Props['title'] = props['title'] // from prop<string>('title')
    const total = (() => count + 1)()        // from derived(...)    → return type
    function handler() { count += 1 }        // functions verbatim

    ;(total)                                 // {total}
    ;(count + 1)                             // {count + 1}
    for (const item of (items)) { ;(item.sku) } // each items as item
    const v = (await (promise)); ;(v)        // await promise then v
    Child({ name: name, code: code })        // <Child name=.. code=../> → checked vs Child Props
}
```

Projecting bindings to value types is what makes auto-deref (`{count}` = the
value, not the signal wrapper) type-check correctly. The shadow is synthetic and
never executed, so its types need not match the runtime module's — the runtime
default export is still `component(host, $props)`.

`state(X)` → `let name = (X)`; `derived(F)` → `const name = (F)()`; `prop<T>(key)`
→ `let name: Props[key] = props[key]` with `key: T` (or `key?: T`) added to
`Props`. Everything else (functions, plain `const`s, imports) is emitted verbatim.

### Prop type surface

`prop` gains a type-only generic so a binding carries a type and required/optional
is expressible:

```ts
let title = prop<string>('title')             // required
let lang  = prop<string | undefined>('lang')  // optional
```

`desugarSignals.signalCallee` already inspects the `prop(...)` call; it is
extended to read the type argument. The same read feeds the shadow scope and the
`Props` interface, so a parent writing `<Child lang={42}/>` gets an error.

### Source mapping

`parseTemplate` records an absolute `loc` (start offset in the `.abide` file) on
each expression carrier — additive optional fields the runtime back-ends
(`generateBuild`/`generateSSR`) ignore, so runtime output is unchanged. Because
each expression's raw text is emitted verbatim, every mapping is a simple
`{ shadowStart, sourceStart, length }` segment; a diagnostic's shadow offset
translates back to a `.abide` range by the segment it lands in. Diagnostics that
land outside any segment (in synthesised scaffolding) are dropped.

### Delivery

- `abide check` — builds a `ts.Program` over the shadows via the custom host,
  remaps diagnostics, prints them against the `.abide` files (the `svelte-check`
  analog).
- `abide lsp` — a `ts.LanguageService` over the same host; `didOpen`/`didChange`
  publish mapped diagnostics. A Zed extension registers the `.abide` language and
  spawns `abide lsp`, so squiggles show in-editor.

## Consequences

- The template + props layer joins the end-to-end typed surface; child-component
  usage is checked.
- One new dialect rule becomes load-bearing for typing: `prop` takes a type
  argument. Documented as user-facing API.
- The wire boundary is unchanged — over the network args/return are still
  JSON-decoded and asserted, not validated. Orthogonal to this ADR.
- `parseTemplate` now skips a top-level `<style>` (CSS braces would otherwise
  parse as interpolations in the shadow path); a no-op for the runtime path,
  which strips style before parsing.
