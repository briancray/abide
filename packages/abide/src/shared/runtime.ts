// The template runtime: what the COMPILER writes, and what reads what it wrote.
//
// Nothing here is a name an author types. Fourteen of them are emitted — eleven by the template
// header in `$compiler/internal/emit.ts`, three by `abide build` into the generated client entry —
// and the five predicates below are how the two renderers and the harness read the shapes those
// calls produce.
//
// Each of the eleven is what the compiler writes for a SPELLING, except `start`, which is written for
// a POSITION: the memos an unconditional plain slot reads, so their loads are in flight before the
// walk arrives at the slot that renders them.
//
// It is on its own specifier so that `abide` holds only what somebody TYPES: a name that appears in
// generated output and never in a source file is surface an app has to read past.
//
// `html` is the one emitted name deliberately NOT here. The compiler writes it as the template TAG
// and a hand-written `.ts` component writes the same tag, so it stays on `abide`, where the author's
// own import merges into the emitted statement and no cross-module dedupe is needed.
//
// Nothing here may import a RENDERER. `$shared` only, so that importing the runtime — which every
// compiled file does, on both lanes — never drags the DOM substrate into a server render. That is
// also why `hydrate` is on `abide/ui` rather than here, though the generated entry is now its only
// caller in an app.

// `class:` / `style:` toggles.
export { classes, styles } from './attrs.ts'
// The blocks and `by` on a `{#for}` — plus the shapes those build, and the predicates that read them
// back. `raw` is NOT here: the escape hatch is spelled with its own name now, so it is a name an author
// types and it lives on `abide` beside `html`. `Raw` stays, because it is the shape the walk matches on
// and both renderers read it back.
export {
    type Awaited,
    awaited,
    type Boundary,
    boundary,
    type Branches,
    cellProps,
    classifySlots,
    type Component,
    component,
    escape,
    type Given,
    isKeyed,
    isTemplate,
    type Keyed,
    keyed,
    propCell,
    type Raw,
    type SlotKind,
    start,
    type Streamed,
    streamed,
} from './html.ts'
// What `abide build` writes into `.abide/client.entry.ts`: the route table, and the two calls that
// put it on screen. An app names none of these — the build wrote the file that does — so the table's
// own types are here too rather than on `abide`, which keeps `route()` and the thing it reads apart.
export {
    type Loader,
    outlet,
    ready,
    type RouteEntry,
    routes,
    type View,
    type ViewModule,
} from './router.ts'
// A compiled `<style>` block registers itself through this.
export { adopt } from './styles.ts'

// What a server module elides to — `remote` / `remoteSocket` and the shapes describing one — is on
// `abide/runtime/transport`, NOT here, and the reason is which chunk it ends up in. This module is
// imported by the generated client entry, so it is in the bundle every page loads; anything
// re-exported from here that survives shaking is in there too. One lazy route with one rpc put the
// whole call-and-decode path in front of every page that way — 4,066 bytes of the perf app's shared
// entry, on a page that calls nothing. Its own specifier makes it the chunk of whoever imports it.
// `WireOptions` is the exception and stays on `abide`: `health()` takes it, so it is the input type
// of a call an app makes.
