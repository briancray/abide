// The template runtime: what the COMPILER writes, and what reads what it wrote.
//
// Nothing here is a name an author types. Twelve of them are emitted — ten by the template header in
// `$compiler/internal/emit.ts` and the transport elider in `$compiler/internal/elide.ts`, three by
// `abide build` into the generated client entry — and the four predicates below are how the two
// renderers and the test kit read the shapes those calls produce.
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
// The blocks, the `{html(...)}` escape hatch, and `by` on a `{#for}` — plus the shapes those build,
// and the predicates that read them back.
export {
    type Awaited,
    awaited,
    type Boundary,
    boundary,
    type Branches,
    classifySlots,
    escape,
    isKeyed,
    isTemplate,
    type Keyed,
    keyed,
    type Raw,
    raw,
    type SlotKind,
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
// What a server module elides to in the client lane — the stub, in place of the handler's body — and
// the shapes that describe one. `WireOptions` is the exception and stays on `abide`: `health()` takes
// it, so it is the input type of a call an app makes.
export {
    type CallOptions,
    type Kind,
    type Method,
    type RemoteOptions,
    remote,
    type RemoteSocket,
    type RemoteSocketOptions,
    remoteSocket,
    type Rpc,
    type RpcHandle,
    type Wire,
} from './transport.ts'
