// WHAT A CALL'S ARGS ARE BEFORE ITS HANDLER SEES THEM, for every lane that lets a call to a handler in
// off the wire: over http (16.2) and a `GET` followed over the socket mux (18.3). Each lane reads the
// args off its own transport and answers a refusal in its own form.

import { DERIVED_ARGS } from '#shared/DERIVED_ARGS.ts'
import { normalized } from '#shared/reactive/argsContract.ts'
import { validationError } from '#shared/refuse.ts'

import type { Mounted } from './answerRpc.ts'
import { coerceArgs } from './coerceArgs.ts'

/**
 * The args a call over the wire is answered with, out of the args it sent: the text a URL or a form
 * carried coerced where `query` says the args are text, the handler's parameter defaults laid in, and
 * the result held to the handler's annotation. Throws the refusal where it is not held.
 *
 * 19.7 — the text as the types the handler's `args` declares. 11.27 — then the defaults, ahead of
 * every key taken after it: the seed a render filed and the `global` entry standing were both filed
 * under them (11.29). 19.9 — THE WIRE HELD TO THE ANNOTATION, where no `args` schema is declared to
 * hold it — the check the handler carries (`derivedArgs`), which its in-process call makes too (15.8).
 */
export function argsFor(
    found: Pick<Mounted, 'handler' | 'argsDocument'>,
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
    const args = normalized(found.handler, coerced)
    const issues = found.handler[DERIVED_ARGS]?.(args) ?? null
    if (issues !== null) throw validationError(issues)
    return args
}
