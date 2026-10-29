// 16.18, 19.7, 19.9, 38.61 — WHAT A CALL'S ARGS ARE BEFORE ITS HANDLER SEES THEM, asked without a
// request or a scope: name and value pairs collapsed (a name given twice a list, for a query, a form
// and `abide call` alike), text coerced to the declared types, and the result held to the annotation.

import { expect, test } from 'bun:test'
import { GET } from '#server'
import type { Mounted } from '#server/answerRpc.ts'
import { argsFor } from '#server/argsFor.ts'
import { collapsed } from '#server/coerceArgs.ts'
import { derivedArgs } from '#server/derivedArgs.ts'
import { isFailed } from '#shared/Failed.ts'

const SCHEMA: Mounted['argsDocument'] & Mounted['args'] = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['id'],
}

// The handler as the module it is loaded through leaves it: held to the schema its annotation derives.
function heldTo(
    schema: Mounted['args'],
): Pick<Mounted, 'handler' | 'argsDocument'> {
    const handler = GET(
        (_args: { id: number; tags?: string[] }) => 1,
    ) as Mounted['handler']
    derivedArgs(handler, schema as NonNullable<Mounted['args']>)
    return { handler, argsDocument: SCHEMA }
}

const found = heldTo(SCHEMA)

// 16.18, 38.61 — THE REVERT: keep only the last value of a repeated name in `collapsed`; `tags` reads
// 'b' and the CLI's `tag=a tag=b` sends one.
test('a name given twice is a list, given once its text — 16.18, 38.61', () => {
    expect(collapsed(new URLSearchParams('id=4&tags=a&tags=b'))).toEqual({
        id: '4',
        tags: ['a', 'b'],
    })
})

// 19.7 — THE TEXT A URL CARRIED, AS THE DECLARED TYPES, and a body's JSON as it was sent. THE REVERT:
// coerce only where the query is non-empty; a form's `''` reads as JSON and `id` stays '4'.
test('text args are coerced and JSON args are not — 19.7', () => {
    expect(argsFor(found, { id: '4', tags: 'a' }, '?id=4&tags=a')).toEqual({
        id: 4,
        tags: ['a'],
    })
    expect(argsFor(found, { id: '4' }, '')).toEqual({ id: 4 })
    expect(argsFor(found, { id: 4 }, undefined)).toEqual({ id: 4 })
})

// 19.9 — ARGS THAT DO NOT HOLD TO THE ANNOTATION ARE REFUSED, thrown as the refusal answered. THE
// REVERT: drop the `DERIVED_ARGS` check; the text id is handed to the handler.
test('args that do not hold to the annotation are refused — 19.9', () => {
    let refused: unknown
    try {
        argsFor(found, { id: 'four' }, '?id=four')
    } catch (thrown) {
        refused = thrown
    }
    expect(isFailed(refused) && refused.status).toBe(422)
})

// 19.9 — NO ARGS AT ALL ARE AN EMPTY RECORD, held to the same annotation: a required member missing is
// refused rather than handed to a handler that destructures nothing. Args with nothing required
// still arrive as none. THE REVERT: skip validation where nothing was sent; the call is let through.
test('a call that sends no args is held to the annotation — 19.9', () => {
    let refused: unknown
    try {
        argsFor(found, undefined, '')
    } catch (thrown) {
        refused = thrown
    }
    expect(isFailed(refused) && refused.status).toBe(422)
    expect(
        argsFor(heldTo({ ...SCHEMA, required: [] }), undefined, ''),
    ).toBeUndefined()
})
