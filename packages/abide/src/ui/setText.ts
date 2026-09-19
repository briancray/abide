import { WORK } from '#shared/WORK.ts'

// What a slot's binding writes, and where a COMPILED SLOT RUNNING is counted. The emitted watch
// is `watch(() => setText(node, escapeless(a) + '…' + escapeless(b)))`, the node resolved once
// before it, so this is the LAST call in it and the only one that runs exactly once per slot
// however many dynamic parts the run has. `bindingRuns` is counted here rather than in the emitted code so the count is a
// property of the runtime and not of what a particular emitter remembered to write.
//
// The COMPARE is the rest of the point: a write to `data` that does not change it still costs,
// and a slot re-run by a value that landed on the same string is the common case rather than the
// rare one.
export function setText(node: Text, value: unknown): void {
    WORK.bindingRuns += 1
    const next = value == null ? '' : String(value)
    if (node.data !== next) node.data = next
}
