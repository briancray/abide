// 39.4 — THE MERGE HAS A SHORT PATH, and each shape of input has to come out as the whole merge
// would write it: the shell's own merge reused when the levels key nothing it keys, and the whole
// opening rewritten when they do. `layout.test.ts` holds the served cases; these are the shapes a
// served app does not happen to reach.

import { expect, test } from 'bun:test'

import { renderDocument } from '#server/render.ts'

const heads = async (shell: string, head: string): Promise<string> => {
    const html = new TextDecoder().decode(
        await renderDocument(() => ({ head, body: '' }), shell),
    )
    return html.slice(0, html.indexOf('</head>'))
}

const tags = (html: string, pattern: RegExp): string[] | null =>
    html.match(pattern)

// THE REVERT: return `shell.merged` unmerged (the opening as written) and the first reads two
// titles, the shell's first.
test('a shell keying one thing twice keeps its last, with or without a head below it — 39.4', async () => {
    const shell =
        '<!doctype html><html><head><title>A</title><title>B</title></head><body></body></html>'
    expect(tags(await heads(shell, ''), /<title>[^<]*<\/title>/g)).toEqual([
        '<title>B</title>',
    ])
    expect(
        tags(
            await heads(shell, '<meta name="description" content="x">'),
            /<title>[^<]*<\/title>/g,
        ),
    ).toEqual(['<title>B</title>'])
})

// THE REVERT: take the short path whenever no key clashes with the shell's, ignoring a count
// above one among the levels, and the page reads both titles, the layout's first.
test('levels keying one thing twice keep the deepest, where the shell keys nothing of theirs — 39.4', async () => {
    const shell =
        '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
    const merged = await heads(
        shell,
        '<title>Layout</title><title>Page</title>',
    )
    expect(tags(merged, /<title>[^<]*<\/title>/g)).toEqual([
        '<title>Page</title>',
    ])
    expect(merged).toContain('<meta charset="utf-8">')
})

// THE REVERT: count only the levels' keys on the clash path, and the shell's `<title>` stands
// ahead of the page's.
test("a level's key replaces the shell's, and the shell's other keys stand — 39.4", async () => {
    const shell =
        '<!doctype html><html><head><title>Shell</title><meta name="theme-color" content="s"></head><body></body></html>'
    const merged = await heads(shell, '<TITLE>Page</TITLE>')
    expect(tags(merged, /<title>[^<]*<\/title>/gi)).toEqual([
        '<TITLE>Page</TITLE>',
    ])
    expect(merged).toContain('<meta name="theme-color" content="s">')
})
