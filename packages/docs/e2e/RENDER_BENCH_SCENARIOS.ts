// The server-renderable scenarios of the shared `@abide/bench/scenarios` corpus, in corpus order (the
// `server: false` interaction-only ones are in `UPDATE_BENCH_SCENARIOS`). Both bench pages stream one
// row per name, so this list is the row count as well as the names.
//
// It lives here because three specs need it and each used to keep its own copy — one of them as a bare
// `toHaveCount(11)`, which stayed green after the corpus grew only because a streaming list passes
// through 11 on its way to the real total. Kept in sync with `@abide/bench/scenarios` by hand: the e2e
// package deliberately does not import the corpus, so that a scenario added there is a visible, single
// edit here rather than a silently-changing expectation.
export const RENDER_BENCH_SCENARIOS = [
    'static-text',
    'interpolation',
    'attributes',
    'if-else',
    'for-list-100',
    'for-list-1000',
    'for-list-10000',
    'nested-for-if-50',
    'switch',
    'class-style-directives',
    'await-block',
    'many-interpolations',
    'deep-tree-10',
    'component-list-100',
    'component-if',
]
