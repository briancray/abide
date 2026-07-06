/*
Hooks a `tail(count, hooks)` caller passes to a Subscribable's retention
capability.
`replayed` must be signalled in-band exactly once per iteration — after the
last replayed frame, before any live frame, and even when nothing was
replayed — so a window reader can commit its seed atomically instead of
guessing where replay ends (an empty replay keeps the reader's held window;
nothing was replayed, so nothing can duplicate). Sources without the
capability never see hooks.
*/
export interface TailHooks {
    readonly replayed?: () => void
}
