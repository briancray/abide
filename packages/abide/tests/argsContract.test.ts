// 16.18, 19.7, 19.9, 38.61 — WHAT A CALL'S ARGS ARE BEFORE ITS HANDLER SEES THEM, asked without a
// request or a scope: name and value pairs collapsed (a name given twice a list, for a query, a form
// and `abide call` alike), text coerced to the declared types, and the result held to the annotation.

import { expect, test } from 'bun:test'

import { GET } from '#server'
import { type Mounted, mountHandlers } from '#server/answerRpc.ts'
import { handlerFileMount } from '#server/handlerFileMount.ts'
import { argsFor, collapsed, derivedArgs } from '#server/argsContract.ts'
import { isFailed } from '#shared/Failed.ts'

const SCHEMA = {
    type: 'object',
    properties: {
        id: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['id'],
}

// The handler as the module it is loaded through leaves it: held to the schema its annotation
// derives, which its text args are then coerced by too.
function heldTo(schema: typeof SCHEMA): Mounted['handler'] {
    const handler = GET(
        (_args: { id: number; tags?: string[] }) => 1,
    ) as Mounted['handler']
    derivedArgs(handler, schema)
    return handler
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

// 16.65, 16.66, 19.7 — A PATH'S PARAMETERS ARE ARGS TOO, coerced to the declared types where the rest
// of the args are a JSON body, and refused where the request names one as well. THE REVERT: lay the
// path's text in uncoerced; `id` reaches the annotation as '4' and is refused.
test("a path's parameters join the args, coerced, and are never named twice — 16.65, 16.66", () => {
    expect(argsFor(found, { tags: ['a'] }, undefined, { id: '4' })).toEqual({
        tags: ['a'],
        id: 4,
    })
    expect(argsFor(found, undefined, '', { id: '4' })).toEqual({ id: 4 })
    let refused: unknown
    try {
        argsFor(found, { id: 4 }, undefined, { id: '4' })
    } catch (thrown) {
        refused = thrown
    }
    expect(isFailed(refused) && refused.status).toBe(400)
})

// 19.9 — A ROW'S DERIVED SCHEMA REACHES A HANDLER ITS MODULE NEVER HELD TO IT: a bundled
// executable's handler faces file no `derivedArgs`, so the row the build wrote is what the mount
// holds it to. THE REVERT: drop the `derivedArgs` call from `mountHandlers`; `id` arrives as '42'.
test("a mounted row holds its handler to the schema the build derived — 19.9", async () => {
    const loose = GET((_args: { id: number }) => 1)
    const { handlers } = await mountHandlers([
        {
            ...handlerFileMount(
                {
                    address: '/bundled',
                    source: 'bundled.ts',
                    scope: '/',
                    matchers: {},
                },
                {
                    method: 'GET',
                    ui: false,
                    cli: false,
                    mcp: false,
                    description: undefined,
                    copy: undefined,
                    defaults: undefined,
                    args: SCHEMA,
                    result: undefined,
                },
            ),
            load: async () => ({ default: loose }),
        },
    ])
    const mounted = handlers.get('GET /bundled') as Mounted
    expect(argsFor(mounted.handler, { id: '42' }, '?id=42')).toEqual({ id: 42 })
})
