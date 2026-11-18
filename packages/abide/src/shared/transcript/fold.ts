import type { AssistantEvent } from '../AssistantEvent.ts'
import type { AssistantTurn, AssistantTurnPart } from '../AssistantTurn.ts'

/**
 * Folds one event of an answer into the answering turn, in place: a `text` event joins the words
 * before it, a `tool` call is paired with its `input` and its `result` by id, a `permission` prompt
 * waits for its answer, and `done` names why the answer ended. 53.24-53.27.
 *
 * Fold each event once, as it arrives, inside the `patch` of the value holding the turn: folding
 * every event again per chunk costs the square of the answer's length.
 *
 * @param answering the assistant's turn, as `transcript.turn('assistant')` opens it
 * @param event the next event the answer produced
 */
export function fold(answering: AssistantTurn, event: AssistantEvent): void {
    const { parts } = answering
    switch (event.type) {
        case 'text': {
            const last = parts[parts.length - 1]
            if (last?.type === 'text') last.text += event.text
            else parts.push({ type: 'text', text: event.text })
            return
        }
        case 'tool':
            parts.push({
                type: 'tool',
                id: event.id,
                name: event.name,
                input: undefined,
                result: undefined,
                failed: false,
                value: undefined,
            })
            return
        case 'input': {
            const call = callOf(parts, event.id)
            if (call !== undefined) call.input = event.input
            return
        }
        case 'result': {
            const call = callOf(parts, event.id)
            if (call === undefined) return
            call.result = event.text
            call.failed = event.failed
            call.value = event.value
            return
        }
        case 'permission':
            parts.push({
                type: 'permission',
                id: event.id,
                name: event.name,
                input: event.input,
                allowed: undefined,
            })
            return
        case 'done':
            answering.stop = event.stop
    }
}

/** The tool call an `input` or a `result` names, searched from the newest. */
function callOf(
    parts: AssistantTurnPart[],
    id: string,
): Extract<AssistantTurnPart, { type: 'tool' }> | undefined {
    for (let at = parts.length - 1; at >= 0; at--) {
        const part = parts[at]
        if (part?.type === 'tool' && part.id === id) return part
    }
    return undefined
}
