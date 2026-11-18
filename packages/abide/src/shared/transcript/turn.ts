import type { AssistantTurn, AssistantTurnPart } from '../AssistantTurn.ts'

/**
 * A turn with every field it holds set, the parts it is handed or none: the visitor's question, or
 * the answer `transcript.fold` fills. 53.30.
 *
 * @param role who speaks
 * @param parts what the turn opens holding
 */
export function turn(
    role: AssistantTurn['role'],
    parts: AssistantTurnPart[] = [],
): AssistantTurn {
    return { role, parts, stop: undefined, failed: undefined }
}
