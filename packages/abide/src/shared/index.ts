// The isomorphic surface: three primitives, one template tag, same import on both sides.
//
//   state   — own      a value
//   memo    — derive or load one (args declared = cache key; no args = inferred from the body)
//   channel — subscribe to them
//
// The two RENDERERS are separate entry points (`abide/ui`, `abide/server`) because only one of them
// ships to a browser. Nothing here imports either, so a page pays for the renderer it uses.

// What a compiled `class:`/`style:` toggle lands on. Authoring vocabulary too — nothing stops a
// hand-written template from calling them.
export { classes, styles } from './attrs.ts'
export { type Channel, type ChannelOptions, channel } from './channel.ts'
export {
    Awaited,
    awaited,
    Boundary,
    type Branches,
    boundary,
    classifySlots,
    escape,
    html,
    isKeyed,
    isTemplate,
    KEY,
    type Keyed,
    keyed,
    Raw,
    raw,
    type SlotKind,
    Streamed,
    streamed,
    type TemplateResult,
} from './html.ts'
// Per-caller storage. A client never needs it — there is one caller, forever — but the same import
// works there, and it is what a test uses to prove two callers do not share a memo's cache.
export { isolate } from './internal/scopes.ts'
export {
    // Tags name DATA, not the thing holding it, so these are module-level verbs: they reach every
    // slot carrying the tag without the caller knowing which memo that is.
    invalidate,
    type KeyedMemo,
    type MemoHandle,
    type MemoOptions,
    memo,
    refresh,
    type TagSelector,
} from './memo.ts'
export { type Cell, type Memo, type State, scope, state, untrack, watch } from './reactive.ts'
// Where a compiled `<style>` block lands. `styles()` is what a server render puts in <head>.
export { adopt, styleTags } from './styles.ts'
