// 38.117 — what markup completes, read off the text a cursor stands in, and the block list it offers
// held to the parser's.

import { expect, test } from 'bun:test'
import { spawned } from '@abide/harness/gate'
import { parseAbide } from '#compiler/parseAbide.ts'
import { TEMPLATE_BLOCKS } from '#compiler/TEMPLATE_BLOCKS.ts'
import { templateContext } from '#compiler/templateContext.ts'

const at = (text: string) => templateContext(text, text.length)

const SCRIPT = `<script>
import Card from './Card.abide'
import { Row as Line, helper } from './lib.ts'
</script>
{#component Pill(props)}<b/>{/component}
`

// EVERY BLOCK THE LIST OFFERS IS ONE THE PARSER READS, with each arm it names. THE REVERT: add a
// block the parser does not know (`each`); its source parses as an expression, and no block is read.
test('every block and arm offered is one the parser reads — 38.117', () => {
    const written: Record<string, string> = {
        if: '{#if a}x{:else if b}y{:else}z{/if}',
        for: '{#for item of list}x{/for}',
        try: '{#try}x{:catch error}y{:finally}z{/try}',
        component: '{#component Row(props)}x{/component}',
    }
    for (const block of Object.keys(TEMPLATE_BLOCKS)) {
        const source = written[block] as string
        for (const arm of TEMPLATE_BLOCKS[block] ?? [])
            expect(source).toContain(`{:${arm}`)
        const file = parseAbide(source)
        if (block === 'component')
            expect(file.components.map((one) => one.name)).toEqual(['Row'])
        else expect(file.template[0]).toMatchObject({ kind: 'block', block })
    }
})

test('markup is told apart from scripts, expressions and text — 38.117', () => {
    expect(at(`${SCRIPT}{#`)).toEqual({
        kind: 'block',
        typed: '',
        offered: ['if', 'for', 'try', 'component'],
    })
    expect(at(`${SCRIPT}{#if a}{#for x of y}{/for}{:el`)).toEqual({
        kind: 'block',
        typed: 'el',
        offered: ['else', 'else if'],
    })
    expect(at(`${SCRIPT}{#for x of y}<p>{/`)).toMatchObject({
        offered: ['for'],
    })
    expect(at(`${SCRIPT}<Ca`)).toEqual({
        kind: 'tag',
        typed: 'Ca',
        offered: ['Card', 'Line', 'Pill'],
    })
    expect(at(`${SCRIPT}<Card title="a > b" onclick={() => a > b} ti`)).toEqual(
        {
            kind: 'attribute',
            tag: 'Card',
            typed: 'ti',
            written: ['title', 'onclick'],
        },
    )
    // The checker's to answer: a script, an expression, an element's attribute, and text.
    expect(at('<script>\nconst a = b.')).toBeUndefined()
    expect(at(`${SCRIPT}<p>{count.`)).toBeUndefined()
    expect(at(`${SCRIPT}<p cl`)).toBeUndefined()
    expect(at(`${SCRIPT}<p>text`)).toBeUndefined()
})

// A `#` NAMING NOTHING never finished tokenizing, so `{#` typed at the end of a file hung the parser
// — and the language server, which checks the text before it answers a completion. Asked of a child,
// whose deadline is the failure. THE REVERT: drop the stall guard in `tokenize.ts`'s `scan`; the
// child is killed at its deadline.
test('a bare # at the end of a file parses — 38.117', async () => {
    const ran = await spawned(
        [
            'bun',
            '-e',
            "import { parseAbide } from '#compiler/parseAbide.ts'; parseAbide('{#'); parseAbide('<p>{#}</p>'); console.log('parsed')",
        ],
        { cwd: new URL('..', import.meta.url).pathname, deadline: 3_000 },
    )
    expect(ran.stdout.trim()).toBe('parsed')
})
