import type { AgentFrame } from '../server/agent.ts'

/*
Collects an engine's frame stream and asserts the neutral AgentFrame contract
every provider engine must satisfy, throwing a plain Error (test-framework
agnostic) on the first violation:

  - the stream ends with exactly one `done` frame and yields nothing after it
  - every `tool_use` is answered by exactly one `tool_result` carrying the
    same id and name, in use-then-result order
  - no `tool_result` arrives for an unannounced id
  - text deltas are strings

Returns the collected frames plus the `done` frame so a scenario can layer
its provider-specific assertions on top. This is the conformance seam: one
suite of invariants, N engine adapters run against it.
*/
// @readme plumbing
export async function assertAgentFrameConformance(
    stream: AsyncIterable<AgentFrame>,
): Promise<{ frames: AgentFrame[]; done: Extract<AgentFrame, { type: 'done' }> }> {
    const frames: AgentFrame[] = []
    for await (const frame of stream) {
        frames.push(frame)
    }
    if (frames.length === 0) {
        throw new Error('conformance: engine yielded no frames — expected at least a done frame')
    }

    const doneIndexes = frames.flatMap((frame, index) => (frame.type === 'done' ? [index] : []))
    if (doneIndexes.length !== 1) {
        throw new Error(`conformance: expected exactly one done frame, saw ${doneIndexes.length}`)
    }
    if (doneIndexes[0] !== frames.length - 1) {
        throw new Error(
            `conformance: frames continued after done (done at ${doneIndexes[0]} of ${frames.length - 1})`,
        )
    }

    const openToolUses = new Map<string, string>()
    for (const [index, frame] of frames.entries()) {
        if (frame.type === 'text' && typeof frame.delta !== 'string') {
            throw new Error(`conformance: text frame at ${index} has a non-string delta`)
        }
        if (frame.type === 'tool_use') {
            if (openToolUses.has(frame.id)) {
                throw new Error(`conformance: duplicate tool_use id ${frame.id} at ${index}`)
            }
            openToolUses.set(frame.id, frame.name)
        }
        if (frame.type === 'tool_result') {
            const expectedName = openToolUses.get(frame.id)
            if (expectedName === undefined) {
                throw new Error(
                    `conformance: tool_result at ${index} answers unannounced id ${frame.id}`,
                )
            }
            if (frame.name !== expectedName) {
                throw new Error(
                    `conformance: tool_result at ${index} names ${frame.name}, tool_use said ${expectedName}`,
                )
            }
            openToolUses.delete(frame.id)
        }
    }
    if (openToolUses.size > 0) {
        const unanswered = Array.from(openToolUses.keys()).join(', ')
        throw new Error(`conformance: tool_use without a tool_result: ${unanswered}`)
    }

    const done = frames[frames.length - 1] as Extract<AgentFrame, { type: 'done' }>
    return { frames, done }
}
