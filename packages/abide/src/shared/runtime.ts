// The template runtime: what the COMPILER writes, and what reads what it wrote.
//
// Nothing here is a name an author types WHERE IT IS WRITTEN. Fifteen of them are emitted — eleven by
// the template header in `#compiler/internal/emit.ts`, four by `abide build` into the generated client
// entry — and the five predicates below are how the two renderers and the harness read the shapes
// those calls produce. `navigate` is the one that is also authored, and it is re-exported here rather
// than reached for on `abide` for a bundling reason the export itself states.
//
// Each of these is what the compiler writes for a SPELLING — never a name an author types.
//
// It is on its own specifier so that `abide` holds only what somebody TYPES: a name that appears in
// generated output and never in a source file is surface an app has to read past.
//
// `html` is the one emitted name deliberately NOT here. The compiler writes it as the template TAG
// and a hand-written `.ts` component writes the same tag, so it stays on `abide`, where the author's
// own import merges into the emitted statement and no cross-module dedupe is needed.
//
// Nothing here may import a RENDERER. `#shared` only, so that importing the runtime — which every
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
    type Branches,
    boundary,
    type Component,
    cellProps,
    classifySlots,
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
    type Streamed,
    streamed,
} from './html.ts'
// Did a read in the body running right now signal, and get caught on the way out?
//
// The one thing about the signal that is surface, and it is a question about the RUN rather than a
// predicate over a caught value. A body that RETURNS needs neither: the boundary re-throws from the
// slot this reads, so whatever a total `catch` built is discarded. A body that ACTS — the slot binder
// in `#ui/internal/parts.ts`, the harness's recording reader — has already done the acting by then,
// and this is what it asks before it does. `isPending` and `Pending` are on no entry point: reading
// the run is strictly wider, since an async body's signal becomes a rejection and reaches no `catch`.
export { swallowed } from './internal/graph.ts'
// `<slot>fallback</slot>`. Only a slot that HAS a fallback emits it — a bare `<slot/>` stays the
// member access it always was, with no thunk and no effect.
export { slotted } from './internal/slots.ts'
// What the compiler writes for a `watch` in a `<script module>` — one effect per caller, kicked by
// the setup of the component that declared it. Emitter-only, which is why it is here and not on `abide`.
export { scopedEffect } from './reactive.ts'
// What `abide build` writes into `.abide/client.entry.ts`: the route table, the two calls that put it
// on screen, and the `navigate` its link handler makes. An app names none of these AS WRITTEN THERE —
// the build wrote the file that does — so the table's own types are here too rather than on `abide`,
// which keeps `route()` and the thing it reads apart.
//
// `navigate` is the one name on both this specifier and `abide`, and the duplication is what keeps
// the generated entry off the barrel: importing it from `abide` for that one link handler pulled
// `identity`, `online`, `memo` and `tags` into the chunk EVERY page loads — 4,338 minified bytes on
// the perf app, which is 7.3% of its first load, for a name already sitting in `router.ts` one import
// down. An author still types `navigate` and still reaches for it on `abide`; nothing about the two
// re-exports differs but which chunk the importer lands in.
export {
    type Loader,
    navigate,
    outlet,
    type RouteEntry,
    ready,
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
