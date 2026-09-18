import { WORK } from '#shared/WORK.ts'

// What a slot's binding writes, and the one place a COMPILED SLOT RUNNING is observable — the
// emitted `watch(() => setText(...))` calls nothing else. `bindingRuns` is counted here rather
// than in the emitted code so the count is a property of the runtime and not of what a
// particular emitter remembered to write.
//
// The COMPARE is the rest of the point: a write to `data` that does not change it still costs,
// and a slot re-run by a value that landed on the same string is the common case rather than the
// rare one.
export function setText(node: Text, value: unknown): void {
    WORK.bindingRuns += 1
    const next = value == null ? '' : String(value)
    if (node.data !== next) node.data = next
}
