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
// Three surfaces read these prefixes: the emitter (`streamScheduler`), the DOM ops both transports run
// over them (`streamPatchDom` — imported directly by the soft-nav applier, stringified into the
// first-load preamble by `documentPatchPreamble`), and the claim walk that strips the sentinels on
// hydrate (`runtime.unwrapStreamSlot` / `streamSentinelBefore`). A prefix changed in two of the three
// is a stranded placeholder that never fills, with no error anywhere.
//
// It used to be four, because the two transports each implemented the geometry: the readable
// TypeScript one and a hand-minified string one that had to be kept in step by hand, and only the
// first was tested. They are one now, so this constant reaches the ops as a PARAMETER — the
// stringified functions can close over nothing.
export const STREAM_SENTINEL = { pending: 'ab-p:', list: 'ab-l:' } as const
