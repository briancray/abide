// WHAT A CALL'S ARGS ARE BEFORE ITS HANDLER SEES THEM, for every lane that lets a call to a handler in
// off the wire: over http (16.2) and a `GET` followed over the socket mux (18.17). Each lane reads the
// args off its own transport and answers a refusal in its own form.

import { normalised } from '#shared/reactive/argsContract.ts'
import { validationError } from '#shared/refuse.ts'
import { validateJson } from '#shared/validateJson.ts'
import type { Mounted } from './answerRpc.ts'
import { coerceArgs } from './coerceArgs.ts'

/**
 * The args a call over the wire is answered with, out of the args it sent: the text a URL or a form
 * carried coerced where `query` says the args are text, the handler's parameter defaults laid in, and
 * the result held to the handler's annotation. Throws the refusal where it is not held.
 *
 * 19.8 — the text as the types the handler's `args` declares. 11.27 — then the defaults, ahead of
 * every key taken after it: the seed a render filed and the `global` entry standing were both filed
 * under them (11.29). 19.10 — THE WIRE HELD TO THE ANNOTATION, where no `args` schema is declared to
 * hold it; args that did not come are the handler's to answer.
 */
export function argsFor(
    found: Pick<Mounted, 'handler' | 'argsDocument' | 'wireArgs'>,
    sent: unknown,
    query: string | undefined,
): unknown {
    const coerced =
        query === undefined
            ? sent
            : coerceArgs(
                  sent as Record<string, string | string[]> | undefined,
                  found.argsDocument,
                  query,
              )
    const args = normalised(found.handler, coerced)
    if (found.wireArgs !== undefined && args !== undefined) {
        const issues = validateJson(found.wireArgs, args)
        if (issues !== null) throw validationError(issues)
    }
    return args
}
