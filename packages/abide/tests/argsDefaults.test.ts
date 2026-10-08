// 11.30 — AN `args` SCHEMA DEFAULTING A MEMBER THE BODY'S PARAMETER DOES NOT IS WARNED ON, at the
// `args` it is written in: the key is taken before `args` runs (11.26), so that default splits one
// call into two entries. Read without running the schema — a `jsonSchema` document's `default`, or a
// Standard Schema's declared input and output — and a `.ts` as much as a `.abide`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import type { Diagnosis } from '#compiler/TypeSession.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const QUERIES = `import { jsonSchema, reactive, type StandardSchemaV1 } from 'abide'

export const unwritten = reactive(({ page }: { page?: number }) => page, {
    args: jsonSchema({ type: 'object', properties: { page: { type: 'integer', default: 1 } } }),
})

export const written = reactive(({ page = 1 }: { page?: number }) => page, {
    args: jsonSchema({ type: 'object', properties: { page: { type: 'integer', default: 1 } } }),
})

declare const sized: StandardSchemaV1<{ size: number }> & {
    '~standard': { types?: { input: { size?: number; q: string }; output: { size: number; q: string } } }
}

export const standard = reactive(({ size, q }: { size?: number; q: string }) => [size, q], {
    args: sized,
})

export const checked = reactive(({ page }: { page?: number }) => page, {
    args: (value: unknown) => value as { page?: number },
})
`

const PAGE = `<script>
import { jsonSchema, reactive } from 'abide'

const rows = reactive(({ limit }: { limit?: number }) => limit, {
    args: jsonSchema({ type: 'object', properties: { limit: { type: 'integer', default: 20 } } }),
})
</script>

<p>page</p>`

let app = ''
let found: Diagnosis[] = []

beforeAll(async () => {
    app = appFixture({
        'package.json': JSON.stringify({
            name: 'args-defaults-fixture',
            type: 'module',
            imports: { '#ui/*': './ui/*', '#shared/*': './shared/*' },
        }),
        'ui/pages/page.abide': PAGE,
        'shared/queries.ts': QUERIES,
    })
    found = (await checkApp(app)).filter((diagnosis) =>
        diagnosis.message.includes('11.30'),
    )
}, 60_000)

afterAll(removeTemporaryModules)

function place(text: string, needle: string): { line: number; column: number } {
    const at = text.indexOf(needle)
    const before = text.slice(0, at)
    return {
        line: before.split('\n').length,
        column: at - before.lastIndexOf('\n'),
    }
}

// THE REVERTS: drop `documentDefaults` and neither document default is found (1 against 3); drop
// `standardDefaults` and `size` goes unfound (2 against 3). `written` defaults in the parameter too
// and `checked` is a function that says nothing, so neither is warned on.
test('an args default the parameter does not write is warned on at the args — 11.30', () => {
    expect(
        found.map(({ path, line, column, category }) => ({
            file: path.slice(app.length + 1),
            line,
            column,
            category,
        })),
    ).toEqual([
        {
            file: 'shared/queries.ts',
            ...place(QUERIES, 'jsonSchema({'),
            category: 'warning',
        },
        {
            file: 'shared/queries.ts',
            ...place(QUERIES, 'sized,'),
            category: 'warning',
        },
        {
            file: 'ui/pages/page.abide',
            ...place(PAGE, 'jsonSchema({'),
            category: 'warning',
        },
    ])
    expect(found[0]?.message).toContain('`page`')
    expect(found[1]?.message).toContain('`size`')
    expect(found[2]?.message).toContain('`limit`')
})

// A WARNING, AND THE BUILD GOES ON. THE REVERT: drop `unkeyed` from `compileApp`'s warnings; the
// build's warnings carry no 11.30.
test('a build warns on an args default the parameter does not write, and compiles — 11.30', async () => {
    const compiled = await compileApp(app)
    const warned: string[] = []
    for (const warning of compiled.warnings)
        if (warning.message.includes('11.30'))
            warned.push(warning.path.slice(app.length + 1))
    expect(warned).toEqual([
        'shared/queries.ts',
        'shared/queries.ts',
        'ui/pages/page.abide',
    ])
}, 60_000)
