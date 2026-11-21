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

// THE REVERT: write `style="position: fixed"` on the tooltip, and it is named. A fixed style a
// clause requires (49.6) is written by the shared module the clause governs — `anchored`'s
// `pointer-events` for 50.48 — never in a component's markup.
test('a shipped component writes a style only from a computed value — 49.6', async () => {
    const fixed: string[] = []
    for (const { path, text } of await files('**/*.abide'))
        if (/\sstyle(?::[\w-]+)?=["']/.test(template(text))) fixed.push(path)
    expect(fixed).toEqual([])
})

// 49.9 — A COMPONENT OVER PARTS renders its widget through the parts function an app can spread
// itself, exported beside it, and its own markup does nothing for the widget: no handler, no role and
// no `aria-` attribute of its own, every one of them the parts'.
// THE REVERT: write Range's thumbs' `onkeydown` in `Range.abide` again, and it is named.
const OVER_PARTS: Record<string, { module: string; name: string }> = {
    'Range.abide': { module: 'range.ts', name: 'range' },
    'CommandPalette.abide': {
        module: 'commandPalette.ts',
        name: 'commandPalette',
    },
    'SortableTable.abide': {
        module: 'sortableTable.ts',
        name: 'sortableTable',
    },
}

test('a component over a parts function renders through it, and does nothing of its own — 49.9', async () => {
    const barrel = await Bun.file(
        new URL('../src/shared/index.ts', import.meta.url).pathname,
    ).text()
    const wrong: string[] = []
    for (const [component, { module, name }] of Object.entries(OVER_PARTS)) {
        const text = await Bun.file(`${SOURCE}${component}`).text()
        if (
            !new RegExp(
                `import \\{[^}]*\\b${name}\\b[^}]*\\} from '#shared/${module}'`,
            ).test(text)
        )
            wrong.push(`${component} does not render through ${name}`)
        if (
            !new RegExp(`\\b${name},?\\s*\\} from '\\./${module}'`).test(barrel)
        )
            wrong.push(`${name} is not exported`)
        for (const [attribute] of template(text).matchAll(
            /\s(?:on[a-z]+|role|aria-[a-z]+)=/g,
        ))
            wrong.push(`${component} writes${attribute} of its own`)
    }
    expect(wrong).toEqual([])
})
