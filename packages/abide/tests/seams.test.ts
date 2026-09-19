import { afterAll, expect, test } from 'bun:test'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// The seams resolve and stay one-directional. A shell test, but it is the one that
// fails the moment #shared reaches for #server.
test('every seam entry resolves', async () => {
    await expect(import('#shared')).resolves.toBeDefined()
    await expect(import('#ui')).resolves.toBeDefined()
    await expect(import('#server')).resolves.toBeDefined()
})

// 19.14 — WHAT A PAGE CARRIES IS THE CLOSURE, NOT THE IMPORT LINE. CLAUDE.md prices an import edge
// by the module it LANDS on, and `Schema.ts` is landed on by every page: `Reactive.ts` names it for
// the gates 4.3 puts in front of every write. So one name in it — `validateJson` — put the whole
// JSON Schema validator in every client bundle in the build.
//
// A STRING FROM THE VALIDATOR RATHER THAN A MODULE COUNT: `exclusiveMinimum` is a keyword only it
// spells, and a string literal is the one thing a minifier leaves alone. Asserted in both
// directions, a gate that only checks the absence passing just as well on a build of nothing.
//
// WHAT CARRIES IT IS THE CALL THAT DECLARES ONE: `jsonSchema` imports the validator, and nothing
// every page reaches does. THE REVERT: import `validateJson` into `Schema.ts` and call it from a
// branch for a bare document. This reports `no schema: true` where false is due, and the bundle
// grows from 36,929 to 42,170 minified bytes — 12.4% of a page with one text slot.
test('a client entry declaring no schema does not carry the validator', async () => {
    const dir = temporaryModule({
        'bare.ts': `import { reactive, watch } from 'abide'
const count = reactive(0)
watch(() => {
    ;(globalThis as { seen?: number }).seen = count()
})
`,
        'declared.ts': `import { jsonSchema, reactive } from 'abide'
const count = reactive(0, { schema: jsonSchema({ type: 'number' }) })
;(globalThis as { seen?: number }).seen = count()
`,
    })

    const carries = async (entry: string): Promise<boolean> => {
        const built = await Bun.build({
            entrypoints: [`${dir}/${entry}`],
            target: 'browser',
            minify: true,
        })
        if (!built.success)
            throw new AggregateError(built.logs, `${entry} did not build`)
        const text = await (
            built.outputs[0] as { text(): Promise<string> }
        ).text()
        return text.includes('exclusiveMinimum')
    }

    expect(`no schema: ${await carries('bare.ts')}`).toBe('no schema: false')
    expect(`a schema: ${await carries('declared.ts')}`).toBe('a schema: true')
})
