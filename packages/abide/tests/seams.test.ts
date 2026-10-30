import { afterAll, expect, test } from 'bun:test'

import { emitClient, parseAbide } from '@abide/abide/compiler'

import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// The seams resolve and stay one-directional. A shell test, but it is the one that
// fails the moment #shared reaches for #server.
test('every seam entry resolves', async () => {
    await expect(import('#shared')).resolves.toBeDefined()
    await expect(import('#ui')).resolves.toBeDefined()
    await expect(import('#server')).resolves.toBeDefined()
})

// 19.13 — WHAT A PAGE CARRIES IS THE CLOSURE, NOT THE IMPORT LINE. CLAUDE.md prices an import edge
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
        'bare.ts': `import { reactive, watch } from '@abide/abide'
const count = reactive(0)
watch(() => {
    ;(globalThis as { seen?: number }).seen = count()
})
`,
        'declared.ts': `import { jsonSchema, reactive } from '@abide/abide'
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

// "A STATIC PAGE SHIPS NO RUNTIME", ASSERTED AT THE BUNDLE — which is where it is about to stop
// being self-evident.
//
// Two tests already cover it and both are EMITTER tests: `hydrate.test.ts` asserts a static page
// emits no client module, and `compiler.test.ts` asserts the emitted text carries no runtime
// import. Today the property holds because THE FILE DOES NOT EXIST, and neither test would notice
// if that stopped being the reason.
//
// It would stop. A cursor/painter client (see `explorations/SYNTHESIS.md`) deletes
// `carriesOwnMarkup`: a page carries its own markup so the browser can build from it, every page
// gets a module, and "ships no runtime" becomes a property of what the route table IMPORTS and
// what the bundler pulls through it. `emitClient.ts`'s head records this having been broken once
// already by a subtler cause.
//
// THE MARKER IS A STRING ONLY THE RUNTIME SPELLS — 41.10's mismatch message, which `adoptWalk.ts`
// and `regions.ts` both carry and a minifier leaves alone. BOTH DIRECTIONS, for the reason the
// test above gives: a gate that only checks an absence passes just as well on a build of nothing.
//
// THE REVERT: have `emitClient` answer a module for a static file instead of ''. This reports
// `static: true` where false is due, and the runtime lands on every static page in the build.
test('a static page does not carry the runtime into its bundle', async () => {
    // WHAT THE ROUTE TABLE WOULD IMPORT, including the no-op `compileApp` substitutes where
    // `emitClient` answers nothing — the table holds a row either way, so the bundle is the honest
    // place to ask what that row costs.
    const moduleOf = (source: string): string =>
        emitClient(parseAbide(source), undefined, 'none') ||
        'export default () => {}\n'

    const dir = temporaryModule({
        'static.ts': moduleOf('<h1>static</h1>'),
        'interactive.ts': moduleOf(
            '<button onclick={() => { (globalThis as { hit?: number }).hit = 1 }}>go</button>',
        ),
    })

    const bundled = async (
        entry: string,
    ): Promise<{ carries: boolean; bytes: number }> => {
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
        return {
            carries: text.includes('disagree about this region'),
            bytes: text.length,
        }
    }

    const still = await bundled('static.ts')
    const live = await bundled('interactive.ts')
    expect(`static: ${still.carries}`).toBe('static: false')
    expect(`interactive: ${live.carries}`).toBe('interactive: true')

    // AND A SIZE FLOOR, because the marker alone is not enough and finding that out is what this
    // assertion is. The first revert written for this test imported `warnMismatch` — a real
    // runtime import, landing real runtime code on a static page — and the marker MISSED it: the
    // message string lived in the addressing module, the bundler shook everything else, and the
    // gate passed a page that had just been broken. A marker detects the module it was taken from and nothing
    // else.
    //
    // Measured, minified: the no-op is 35 bytes, the smallest possible runtime leaf
    // (`warnMismatch` alone) is 347, and the interactive page is 4,066. The ceiling sits between
    // the first two, so ANY runtime reaching a static page fails this whether or not it carries
    // the string.
    expect(`static bytes under 256: ${still.bytes < 256}`).toBe(
        'static bytes under 256: true',
    )
    expect(live.bytes).toBeGreaterThan(1000)
})
