// The id PREFIXES of the two streaming-SSR sentinels. Both are `<prefix><id>`, and both name a node the
// server paints and a later actor addresses by `getElementById` / comment-data compare:
//
//   • `pending` — a deferred `{#await}` slot. Painted as `<!--ab-p:N-->fallback<template id="ab-p:N">`,
//                 so the comment marks where the fallback starts and the `<template>` is the O(1) handle.
//                 A `fill` patch deletes the run between them and inserts in its place.
//   • `list`    — a streamed `{#for await}` region. Painted as bare items followed by
//                 `<template id="ab-l:N">`; an `append` patch inserts before it, so document order is
//                 item order at O(1) per patch.
//
// Four surfaces read these prefixes and only one of them is normal TypeScript: the emitter
// (`streamScheduler`), the first-load move-scripts it builds as a MINIFIED STRING (`documentPatch` —
// same DOM ops, run by the parser), the soft-nav applier that redoes those ops in JS
// (`navigate.applyPatchFrame`, because a fetched body's inline scripts don't auto-run), and the claim
// walk that strips the sentinels on hydrate (`runtime.unwrapStreamSlot` / `streamSentinelBefore`). A
// prefix changed in three of the four is a stranded placeholder that never fills, with no error
// anywhere. The move-script copy is a template string assembled at emit time, so it interpolates this
// constant like any other caller rather than restating it.
export const STREAM_SENTINEL = { pending: 'ab-p:', list: 'ab-l:' } as const
