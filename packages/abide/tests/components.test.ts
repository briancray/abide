// THE SHIPPED COMPONENTS' CONTRACT, the part of RULEBOOK 49 a read of their source can decide: no
// stylesheet (49.5), no `class` a component writes (49.3), and a `style` only where a value is
// computed (49.6). What a component RENDERS — its `data-` states, its parts, its roles — is the CRM's
// tests', which mount it.

import { expect, test } from 'bun:test'

const SOURCE = new URL('../src/components/', import.meta.url).pathname

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
test('no shipped component brings a stylesheet — 49.5', async () => {
    const sheets = await files('**/*.{css,scss,sass,less}')
    expect(sheets.map(({ path }) => path)).toEqual([])
    for (const { path, text } of await files('**/*.abide'))
        expect({ path, styled: /<style\b/.test(text) }).toEqual({
            path,
            styled: false,
        })
})

// THE REVERT: write `class="dialog"` on the dialog's root, and it is named.
test('no shipped component writes a class — 49.3', async () => {
    const writing: string[] = []
    for (const { path, text } of await files('**/*.abide'))
        if (/\sclass(?::[\w-]+)?=/.test(template(text))) writing.push(path)
    expect(writing).toEqual([])
})

// A fixed style a clause of the component's own requires, each named with its clause: the one place
// a literal style is not a style an app should have been left to write.
const REQUIRED_STYLES: Record<string, readonly string[]> = {
    // 50.48 — the hint is never the pointer's target.
    'Tooltips.abide': ['style:pointer-events="none"'],
}

// THE REVERT: write `style="position: fixed"` on the tooltip, and it is named.
test('a shipped component writes a style only from a computed value, or one its clause requires — 49.6', async () => {
    const fixed: string[] = []
    for (const { path, text } of await files('**/*.abide')) {
        let markup = template(text)
        for (const required of REQUIRED_STYLES[path.split('/').at(-1) ?? ''] ??
            [])
            markup = markup.replace(required, '')
        if (/\sstyle(?::[\w-]+)?=["']/.test(markup)) fixed.push(path)
    }
    expect(fixed).toEqual([])
})
