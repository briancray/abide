// 32.63, 32.64, 32.65 — A BLOCK TAG THE PARSER CANNOT PLACE IS REFUSED, AT THE TAG. Each case below
// parsed without a word: an unclosed `{#if}` took the rest of the file as its arm, a stray `{:else}`
// or `{/if}` was dropped and the text after it stood where the author never put it, a
// `{#component}` left open in a `<p>` lost the `<p>`, and `{#each}` or `{@html}` surfaced as a
// TypeScript syntax error about a `#` or an `@`.

import { expect, test } from 'bun:test'
import { parseAbide } from '#compiler/parseAbide.ts'
import { Refusals } from '#compiler/Refusals.ts'
import { parseSources } from '#compiler/readSources.ts'

const refusalOf = (source: string): string => {
    try {
        parseAbide(source)
    } catch (thrown) {
        return (thrown as Error).message
    }
    return 'parsed'
}

// THE REVERT: drop the end-of-file check and `refuseCrossing`'s throw; the first two parse.
test('a block never closed is refused — 32.63', () => {
    for (const source of [
        '{#if a}<p>x</p>',
        '<p>{#component Card()}x</p>',
        '<div>{#for x of xs}<i>{x}</i></div>',
        '{#try}<p>x</p>',
    ])
        expect(refusalOf(source), source).toContain('RULEBOOK 32.63')
})

// THE REVERT: let `{:else}` and a closer that names no open block fall through as they did; each
// parses, and `{#try}…{/if}` closes the try without folding its arms.
test('an else arm or a close tag with no block of its name open is refused — 32.64', () => {
    for (const source of [
        '<p>{:else}hi</p>',
        '{/if}tail',
        '{/component}',
        '{#for x of xs}{/if}',
        '{#try}x{/if}',
        '{#if a}{#for x of xs}{/if}',
    ])
        expect(refusalOf(source), source).toContain('RULEBOOK 32.64')
})

// THE REVERT: drop the `unknown` throw; each falls through to an expression slot and parses.
test('a block tag abide has no block for is refused by name — 32.65', () => {
    expect(refusalOf('{#each xs as x}{/each}')).toContain('{#for item of list}')
    expect(refusalOf('{#await p}x')).toContain('no {#await}')
    expect(refusalOf('{@html x}')).toContain('{raw(value)}')
    for (const source of ['{#iffy}', '{/iffy}', '{:then v}', '{@const x = 1}'])
        expect(refusalOf(source), source).toContain('RULEBOOK 32.65')
})

// A near miss is not a block: these are the spellings 32.63-32.65 must leave alone.
test('a well-formed template and a regular expression slot still parse', () => {
    for (const source of [
        '{/abc/.test(x)}',
        '<div>{#if a}<b>x{/if}</div><p>after</p>',
        '{#if a}x{:else if b}y{:else}z{/if}',
        '{#try}x{:catch e}y{:finally}z{/try}',
        '{#component Row(props)}<i/>{/component}<Row/>',
    ])
        expect(refusalOf(source), source).toBe('parsed')
})

// THE REVERT: hand `Refusals.at` no text in `parseSources`; the finding lands at line 0.
test('a block refusal is reported on the line and column of its tag', () => {
    const refusals = new Refusals('/app', true)
    parseSources(
        [{ path: 'page.abide', text: '<main>\n  <p>{:else}</p>\n</main>' }],
        refusals,
    )
    const [found] = refusals.found
    expect(found?.line).toBe(2)
    expect(found?.column).toBe(6)
    expect(found?.message).toContain('RULEBOOK 32.64')

    const throwing = new Refusals('/app', false)
    expect(refusalOfSink(throwing)).toContain('page.abide:1:1 - error')
})

const refusalOfSink = (refusals: Refusals): string => {
    try {
        parseSources([{ path: '/app/page.abide', text: '{#if a}x' }], refusals)
    } catch (thrown) {
        return (thrown as Error).message
    }
    return 'parsed'
}
