// WHICH FRAMEWORK NAMES AN EMITTED CLIENT MODULE IMPORTS FROM `abide` rather than `abide/runtime`:
// the escaping, the url guard, `raw`, `writePath` and `listOf`, which the server's markup and a
// client re-rendering an arm or a row both call. A constants leaf, with no imports of its own.
export const SHARED_NAMES: ReadonlySet<string> = new Set([
    'escapeText',
    'escapeAttribute',
    'escapeStyleValue',
    'safeUrl',
    // 32.38 — present, absent or text: the markup's answer and a built row's.
    'attributeMarkup',
    'attributeText',
    'raw',
    // 32.31's anchored run, which the server's markup and a browser's parsed row both write.
    'markupRun',
    'RAW_WRITES',
    'writePath',
    'listOf',
    // 32.24's abort, which only the server lane can need: a client binding is its own `watch`
    // and gets one from 2.13. Emitted on both sides because `renderMarkup` is both sides.
    'slotValue',
    // 32.5, 32.8 — what a `bind:` operand holds, which the markup writes into the tag.
    'boundValue',
    'groupHolds',
    // 32.6, 33.6, 33.7 — a component's `bind:`, and the cell a child writing that prop builds.
    'boundProp',
    'propCell',
    'propCells',
    // 32.11 — a spread's props, which an invocation passes on both sides, and its markup.
    'spreadProps',
    'spreadAttributes',
    // 10.5's pair: a share scope is opened by the emitted component on both sides, and `#shared`
    // is where the one scope chain lives.
    'enterShare',
    'leaveShare',
    'currentShare',
    'resumeShare',
])
