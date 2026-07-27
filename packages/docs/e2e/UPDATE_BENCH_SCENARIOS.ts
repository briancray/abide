// The interaction-only scenarios of the shared `@abide/bench/scenarios` corpus (`server: false`), in
// corpus order — the ones the client bench drives through a `<button>` click and times as `update`.
// Companion to [RENDER_BENCH_SCENARIOS]; same hand-sync rule.
export const UPDATE_BENCH_SCENARIOS = [
    'state-update',
    'list-append-update',
    'list-reverse-1000',
    'if-toggle',
    'component-if-toggle',
    'list-swap-1000',
    'component-list-swap-1000',
    'list-remove-1000',
    'list-partial-update-1000',
    'list-select-1000',
    'list-replace-1000',
    'list-clear-1000',
]
