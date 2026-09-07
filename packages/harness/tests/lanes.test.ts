import { expect, test } from 'bun:test'

test('the DOM preload ran', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div').nodeName).toBe('DIV')
})

test('every lane entry resolves', async () => {
    await expect(import('harness/measure')).resolves.toBeDefined()
    await expect(import('harness/engine')).resolves.toBeDefined()
    await expect(import('harness/server')).resolves.toBeDefined()
})

// CLAUDE.md, "seams and imports": `harness/measure` has no abide in its graph at all, and that is
// the whole reason the harness is a PACKAGE rather than a folder inside the framework — it is what
// lets the hand-written arm of a ratio be timed by the same clock and the same batch sizing as the
// abide arm. An import that crept in would not break a test: every number would still be produced,
// and every ratio in the repo would be measuring one arm against itself.
//
// Checked on the RESOLVED graph rather than on the source text, because the edge that matters is
// the one three modules deep that nobody typed.
test('the measure lane has no abide in its graph', async () => {
    const entry = new URL('../src/measure/index.ts', import.meta.url).pathname
    const built = await Bun.build({ entrypoints: [entry], target: 'bun', external: ['*'] })
    expect(built.success).toBe(true)

    const seen: string[] = []
    for (const output of built.outputs) {
        const code = await output.text()
        // `from "abide"`, a bare `import "abide"`, and `require("abide")` alike — the first
        // version of this looked for `from` alone and passed against a side-effect import.
        for (const match of code.matchAll(
            /(?:from|import|require\()\s*["'](abide(?:\/[\w-]+)?)["']/g,
        )) {
            seen.push(match[1] ?? '')
        }
        if (/packages\/abide\//.test(code)) seen.push('packages/abide')
    }
    expect([...new Set(seen)]).toEqual([])
})
