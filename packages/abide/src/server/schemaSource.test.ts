import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadApp } from './internal/loadApp.ts'

// WHICH SCHEMA SOURCE OUT-RANKS THE OTHER is the caller's question, not a question about which files
// happen to be on disk (`LoadAppOptions.schemas`).
//
// It used to be inferred: `loadApp` preferred `dist/schemas.json` whenever it existed, and `abide build`
// opted out by DELETING the file first. Nothing else opted out — so in any project that had run
// `abide build` or `abide compile` even once, `abide dev` and every one of its rebuilds merged the stale
// map and never re-derived. An edited handler signature kept validating against the previous build's
// schema for the whole session, in the one lane whose entire job is reflecting edits.
//
// A value test cannot see this: the app boots, the rpc answers, and the only thing that is wrong is
// WHICH schema the router validated against. So this asserts the schema itself, from a bake that could
// not possibly have been derived from the source beside it.

const BOGUS_BAKE = {
    greet: {
        input: { type: 'object', properties: { fromTheBake: { type: 'string' } } },
        output: { type: 'object', properties: { fromTheBake: { type: 'string' } } },
    },
}

async function project(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'abide-schema-source-'))
    await mkdir(join(dir, 'src/server/rpc'), { recursive: true })
    await mkdir(join(dir, 'dist'), { recursive: true })
    // One read whose input schema is DERIVABLE from the destructuring default, so the live answer and
    // the baked answer are distinguishable by a field name rather than by a shape.
    await writeFile(
        join(dir, 'src/server/rpc/greet.ts'),
        [
            `import { GET } from '${join(import.meta.dir, 'GET.ts')}'`,
            'export default GET(({ fromTheSource = 0 }) => ({ n: fromTheSource }))',
        ].join('\n'),
    )
    await writeFile(join(dir, 'dist/schemas.json'), JSON.stringify(BOGUS_BAKE))
    return dir
}

function inputProperties(loaded: Awaited<ReturnType<typeof loadApp>>): string[] {
    const route = loaded.routes?.greet
    if (route === undefined) throw new Error('expected the greet route')
    const input = route.__rpc.options.schemas?.input as
        | { properties?: Record<string, unknown> }
        | undefined
    return Object.keys(input?.properties ?? {})
}

describe('the schema source is declared, not inferred from a file existing', () => {
    test("'baked' uses dist/schemas.json verbatim — the production answer, no tsgo at boot", async () => {
        const dir = await project()
        try {
            expect(inputProperties(await loadApp(dir, { schemas: 'baked' }))).toEqual([
                'fromTheBake',
            ])
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test("'source' ignores a bake left by an earlier build — what `abide dev` and `abide build` ask for", async () => {
        const dir = await project()
        try {
            // FAILS before `LoadAppOptions.schemas`: the bake existed, so it won, and the dev lane
            // served the previous build's types for the rest of the session.
            expect(inputProperties(await loadApp(dir, { schemas: 'source' }))).toEqual([
                'fromTheSource',
            ])
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test('the default is baked-if-present, so a caller that says nothing keeps the boot-time behaviour', async () => {
        const dir = await project()
        try {
            expect(inputProperties(await loadApp(dir))).toEqual(['fromTheBake'])
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })
})
