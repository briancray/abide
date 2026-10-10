// 16.18, 19.7, 19.9, 38.62 — WHAT A CALL'S ARGS ARE BEFORE ITS HANDLER SEES THEM, asked without a
// request or a scope: name and value pairs collapsed (a name given twice a list, for a query, a form
// and `abide call` alike), text coerced to the declared types, and the result held to the annotation.

import { expect, test } from 'bun:test'
import { GET } from '#server'
import type { Mounted } from '#server/answerRpc.ts'
import { argsFor } from '#server/argsFor.ts'
import { collapsed } from '#server/coerceArgs.ts'
import { isFailed } from '#shared/Failed.ts'

const SCHEMA: Mounted['argsDocument'] & Mounted['wireArgs'] = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['id'],
}

const found: Pick<Mounted, 'handler' | 'argsDocument' | 'wireArgs'> = {
    handler: GET(
        (_args: { id: number; tags?: string[] }) => 1,
    ) as Mounted['handler'],
    argsDocument: SCHEMA,
    wireArgs: SCHEMA,
}

// 16.18, 38.62 — THE REVERT: keep only the last value of a repeated name in `collapsed`; `tags` reads
// 'b' and the CLI's `tag=a tag=b` sends one.
test('a name given twice is a list, given once its text — 16.18, 38.62', () => {
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
    expect(argsFor(found, undefined, '')).toBeUndefined()
})

// 19.9 — ARGS THAT DO NOT HOLD TO THE ANNOTATION ARE REFUSED, thrown as the refusal answered. THE
// REVERT: drop the `validateJson` step; the text id is handed to the handler.
test('args that do not hold to the annotation are refused — 19.9', () => {
    let refused: unknown
    try {
        argsFor(found, { id: 'four' }, '?id=four')
    } catch (thrown) {
        refused = thrown
    }
    expect(isFailed(refused) && refused.status).toBe(422)
})
