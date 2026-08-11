// What the COMPILER writes, and nothing else does.
//
// Every name here is emitted — six by the template header in `$compiler/internal/emit.ts`, two by the
// transport elider in `$compiler/internal/elide.ts` — and none of them is a spelling an author reaches
// for. They are on their own specifier so that `abide` holds only what somebody TYPES: a name that
// appears in generated output and never in a source file is surface an app has to read past.
//
// `html` is the one name deliberately NOT here. The compiler emits it as the template TAG, and a
// hand-written `.ts` component writes the same tag — so it stays on `abide`, where the author's own
// import merges into the emitted statement and no cross-module dedupe is needed.
//
// `raw` and `keyed` read like authoring vocabulary and are not: the escape hatch is spelled
// `{html(...)}` in a template and a key is spelled `key={...}` on a `{#for}`. Each is what the
// emitter writes for one of those spellings.

// `class:` / `style:` toggles.
export { classes, styles } from './attrs.ts'
// `{#await}`, `{:catch}` blocks, `{#for await}`, `{html(...)}`, and `key=` on a `{#for}`.
export { awaited, boundary, keyed, raw, streamed } from './html.ts'
// A compiled `<style>` block registers itself through this.
export { adopt } from './styles.ts'
// What a server module elides to in the client lane — the stub, in place of the handler's body.
export { remote, remoteSocket } from './transport.ts'
