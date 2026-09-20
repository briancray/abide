// WHICH FRAMEWORK NAMES AN EMITTED CLIENT MODULE IMPORTS FROM `abide` rather than `abide/runtime`:
// the escaping, the url guard, `raw`, `writePath` and `listOf`, which the server's markup and a
// client re-rendering an arm or a row both call. A constants leaf, with no imports of its own.
export const SHARED_NAMES: ReadonlySet<string> = new Set([
    'escapeText',
    'escapeAttribute',
    'escapeStyleValue',
    'safeUrl',
    'raw',
    'writePath',
    'listOf',
    // 10.5's pair: a share scope is opened by the emitted component on both sides, and `#shared`
    // is where the one scope chain lives.
    'enterShare',
    'leaveShare',
])
