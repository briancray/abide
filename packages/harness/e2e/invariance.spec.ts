// WHAT THE HYDRATION SCHEME IS ALLOWED TO PUT IN THE DOCUMENT. The rule it is held to: a compiler
// may not invent structure that changes what CSS matches or what a DOM query returns. A page that
// styles differently or answers `querySelector` differently because it was compiled is a page the
// author did not write.
//
// This is a CORRECTNESS gate, not a budget, and it runs against a REFERENCE page — the same markup
// with nothing added — so every answer is compared rather than asserted from memory. Two engines,
// because `:empty` and comment handling are exactly the kind of thing that differs.

import { expect, test } from '@playwright/test'

// The shapes a marker scheme touches. `#slot` holds a slot; `#bare` is its reference twin.
const REFERENCE = `
<ul id="list"><li class="a">one</li><li class="b">two</li><li class="c">three</li></ul>
<p id="filled">text</p>
<p id="blank"></p>
<div id="parent"><span>kid</span></div>
`

// The same document with the CURRENT scheme applied: two comments around every slot, and a
// `data-a` on the element carrying a listener.
const COMPILED = `
<ul id="list"><li class="a"><!--a0-->one<!--/a--></li><li class="b"><!--a1-->two<!--/a--></li><li class="c"><!--a2-->three<!--/a--></li></ul>
<p id="filled"><!--a3-->text<!--/a--></p>
<p id="blank"><!--a4--><!--/a--></p>
<div id="parent" data-a="0"><span>kid</span></div>
`

const PROBE = `(() => {
    const q = (s) => document.querySelectorAll(s).length
    const blank = document.querySelector('#blank')
    const filled = document.querySelector('#filled')
    const parent = document.querySelector('#parent')
    return {
        // CSS structural selectors — element-based, and the ones an author writes.
        nthChild2: q('#list li:nth-child(2)'),
        firstChild: q('#list li:first-child'),
        lastChild: q('#list li:last-child'),
        onlyChild: q('#parent span:only-child'),
        adjacent: q('.a + .b'),
        sibling: q('.a ~ .c'),
        childCombinator: q('#parent > span'),
        // :empty is the one that has historically disagreed between engines and levels.
        emptyMatches: q('p:empty'),
        blankIsEmpty: blank.matches(':empty') ? 1 : 0,
        // An attribute selector an app might write over its own markup.
        dataAttributes: q('[data-a]'),
        // DOM queries an app makes about its own document.
        listChildElements: document.querySelector('#list').children.length,
        listChildNodes: document.querySelector('#list').childNodes.length,
        // The node count of the element a slot is INSIDE — the list's own children are elements,
        // so the first probe cannot see a marker at all.
        slotHostChildNodes: document.querySelector('.a').childNodes.length,
        slotHostChildElements: document.querySelector('.a').children.length,
        blankChildNodes: blank.childNodes.length,
        filledFirstChildIsText: filled.firstChild ? filled.firstChild.nodeType : 0,
        filledTextContent: filled.textContent,
        parentChildNodes: parent.childNodes.length,
    }
})()`

test('a compiled document answers CSS and DOM queries as the authored one does', async ({
    page,
}, testInfo) => {
    await page.goto('about:blank')

    await page.setContent(
        `<!doctype html><html><body>${REFERENCE}</body></html>`,
    )
    const authored = await page.evaluate(PROBE)

    await page.setContent(
        `<!doctype html><html><body>${COMPILED}</body></html>`,
    )
    const compiled = await page.evaluate(PROBE)

    const differences: string[] = []
    for (const key of Object.keys(authored as Record<string, unknown>)) {
        const a = (authored as Record<string, unknown>)[key]
        const c = (compiled as Record<string, unknown>)[key]
        if (a !== c) differences.push(`${key}: authored ${a} -> compiled ${c}`)
    }
    console.log(
        `\n=== ${testInfo.project.name} — compiled vs authored ===\n` +
            (differences.length === 0
                ? '  no difference'
                : differences.map((d) => `  ${d}`).join('\n')),
    )

    // A RATCHET, not a pass. These two are what the CURRENT scheme costs, listed by name so that
    // fixing either one fails this test and forces the list to shrink — and so that a THIRD
    // difference appearing fails it too.
    //
    //   dataAttributes           — `data-a` is matched by an attribute selector and by
    //                              `querySelectorAll`, in the document as served, before
    //                              hydration has had a chance to remove it.
    //   filledFirstChildIsText   — a slot's marker makes `element.firstChild` a Comment where the
    //                              authored document has a Text.
    //   slotHostChildNodes       — the element holding a slot has 3 child nodes where the author
    //                              wrote 1, so `childNodes` and any index into it moves.
    //   blankChildNodes          — an element whose slot rendered EMPTY has 2 child nodes where
    //                              the author wrote none. It still matches `:empty`, which is the
    //                              part that had to be checked rather than assumed.
    //
    // Both go when a static region is addressed structurally instead: no invented nodes and no
    // invented attributes is the only scheme that has nothing on this list.
    expect(differences.sort()).toEqual([
        'blankChildNodes: authored 0 -> compiled 2',
        'dataAttributes: authored 0 -> compiled 1',
        'filledFirstChildIsText: authored 3 -> compiled 8',
        'slotHostChildNodes: authored 1 -> compiled 3',
    ])
})

// WHAT IS SAFE, asserted so it is not re-litigated. CSS structural selectors are element-based
// and a comment is not an element, so a marker cannot change what they match — including
// `:empty`, which both engines ignore comments for and which is the one that had to be checked
// rather than assumed.
test('CSS structural matching is untouched by markers', async ({ page }) => {
    await page.goto('about:blank')
    await page.setContent(
        `<!doctype html><html><body>${COMPILED}</body></html>`,
    )
    const matched = await page.evaluate(`(() => {
        const q = (s) => document.querySelectorAll(s).length
        return {
            nth: q('#list li:nth-child(2)'),
            first: q('#list li:first-child'),
            only: q('#parent span:only-child'),
            adjacent: q('.a + .b'),
            sibling: q('.a ~ .c'),
            child: q('#parent > span'),
            empty: q('p:empty'),
        }
    })()`)
    expect(matched).toEqual({
        nth: 1,
        first: 1,
        only: 1,
        adjacent: 1,
        sibling: 1,
        child: 1,
        // Both `#blank` and nothing else: the comments inside it do not stop it being empty.
        empty: 1,
    })
})
