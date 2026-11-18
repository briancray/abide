// THE KIT'S CONTRACT, the part of RULEBOOK 49 a read of its source can decide: no stylesheet (49.5),
// no `class` a component writes (49.3), a `style` only where a value is computed (49.6), and abide
// reached through its two public entries alone (49.7). What a component RENDERS — its `data-`
// states, its parts, its roles — is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

const SOURCE = new URL('../src/', import.meta.url).pathname

async function files(
    pattern: string,
): Promise<{ path: string; text: string }[]> {
    const found: { path: string; text: string }[] = []
    for await (const path of new Bun.Glob(pattern).scan(SOURCE))
        found.push({ path, text: await Bun.file(`${SOURCE}${path}`).text() })
    return found
}

/** A `.abide` file's template: what is left once its script and style blocks are taken out. */
function template(text: string): string {
    return text
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
}

// THE REVERT: add a `Dialog.css` beside the dialog, and it is named.
test('the kit ships no stylesheet — 49.5', async () => {
    const sheets = await files('**/*.{css,scss,sass,less}')
    expect(sheets.map(({ path }) => path)).toEqual([])
    for (const { path, text } of await files('**/*.abide'))
        expect({ path, styled: /<style\b/.test(text) }).toEqual({
            path,
            styled: false,
        })
})

// THE REVERT: write `class="dialog"` on the dialog's root, and it is named.
test('no kit component writes a class — 49.3', async () => {
    const writing: string[] = []
    for (const { path, text } of await files('**/*.abide'))
        if (/\sclass(?::[\w-]+)?=/.test(template(text))) writing.push(path)
    expect(writing).toEqual([])
})

// THE REVERT: write `style="position: fixed"` on the tooltip, and it is named.
test('a kit component writes a style only from a computed value — 49.6', async () => {
    const fixed: string[] = []
    for (const { path, text } of await files('**/*.abide'))
        if (/\sstyle(?::[\w-]+)?=["']/.test(template(text))) fixed.push(path)
    expect(fixed).toEqual([])
})

// THE REVERT: import `isThenable` from `@abide/abide/src/shared/isThenable.ts`, and it is named.
test('the kit reaches abide through its public entries alone — 49.7', async () => {
    const reaching: string[] = []
    for (const { path, text } of await files('**/*.{ts,abide}'))
        for (const [, specifier] of text.matchAll(
            /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
        ))
            if (
                specifier?.startsWith('@abide/') &&
                specifier !== '@abide/abide' &&
                specifier !== '@abide/abide/server'
            )
                reaching.push(`${path}: ${specifier}`)
    expect(reaching).toEqual([])
})
