// WHAT THE HYDRATION SCHEME IS ALLOWED TO PUT IN THE DOCUMENT. The rule it is held to: a compiler
// may not invent structure that changes what CSS matches or what a DOM query returns. A page that
// styles differently or answers `querySelector` differently because it was compiled is a page the
// author did not write.
//
// This is a CORRECTNESS gate, not a budget. The compiled arm is a real `.abide` page built by
// `buildCompiledPage` — the server's markup as served, and the same document again once the client
// has mounted into it — and every answer is compared against a REFERENCE page, the same markup
// written by hand with nothing added. Two engines, because `:empty` and comment handling are
// exactly the kind of thing that differs.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

// TWO KINDS OF REGION IN ONE PAGE. `#list`, `#filled` and `#blank` are STATIC markup holding
// slots — a text slot, a slot whose value is empty, a listener — and there the compiler may add
// nothing at all. `#parent` and `#rows` hold a `{#if}` and a `{#for}`, the dynamic boundaries,
// and there a comment pair is what it is allowed to add.
const PAGE_SOURCE = `<script>
import { reactive } from '@abide/abide'

let first = reactive('one')
let text = reactive('text')
let nothing = reactive('')
let items = reactive(['one', 'two', 'three'])
let shown = reactive(true)
</script>

<ul id="list"><li class="a" onclick={() => first = first + '!'}>{first}</li><li class="b">two</li><li class="c">three</li></ul>
<p id="filled">{text}</p>
<p id="blank">{nothing}</p>
<div id="parent">{#if shown}<span>kid</span>{/if}</div>
<ol id="rows">{#for item of items}<li>{item}</li>{/for}</ol>
<section id="deep"><div class="mid"><article><p class="leaf">deep</p></article></div></section>`

/** The authored document: what `PAGE_SOURCE` renders, written by hand with nothing added. */
const REFERENCE =
    '<ul id="list"><li class="a">one</li><li class="b">two</li><li class="c">three</li></ul>' +
    '<p id="filled">text</p>' +
    '<p id="blank"></p>' +
    '<div id="parent"><span>kid</span></div>' +
    '<ol id="rows"><li>one</li><li>two</li><li>three</li></ol>' +
    '<section id="deep"><div class="mid"><article><p class="leaf">deep</p></article></div></section>'

const compiled = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/abide/bench/buildCompiledPage.ts'
console.log(JSON.stringify(await buildCompiledPage(${JSON.stringify(PAGE_SOURCE)})))
`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as { markup: string; script: string }

type Answers = Record<string, number | string>

// DOM QUERIES over every element but the two that hold a dynamic boundary — every place a slot or
// a static text run sits, and nothing may be added to. Walked rather than picked, because a probe
// that names three elements is blind to the fourth: an earlier version read only the slot hosts
// and passed with a marker round every STATIC text run in the page.
const DOM_PROBE = `(() => {
    const answers = {
        // An attribute selector an app might write over its own markup — what a \`data-\` marker
        // on a listener element would be matched by.
        dataAttributes: document.querySelectorAll('[data-a]').length,
        // :empty is the one that has historically disagreed between engines and levels.
        blankIsEmpty: document.querySelector('#blank').matches(':empty') ? 1 : 0,
    }
    let at = 0
    for (const element of document.body.querySelectorAll('*')) {
        at += 1
        if (element.id === 'parent' || element.id === 'rows') continue
        const name = at + ' ' + element.localName + (element.id ? '#' + element.id : '') +
            (element.className ? '.' + element.className : '')
        answers[name + ' childNodes'] = element.childNodes.length
        answers[name + ' children'] = element.children.length
        answers[name + ' firstChild'] = element.firstChild ? element.firstChild.nodeType : 0
        answers[name + ' textContent'] = element.textContent
    }
    return answers
})()`

// CSS STRUCTURAL MATCHING over the WHOLE document, the dynamic boundaries included.
const CSS_PROBE = `(() => {
    const q = (s) => document.querySelectorAll(s).length
    return {
        nth: q('#list li:nth-child(2)'),
        first: q('#list li:first-child'),
        last: q('#list li:last-child'),
        only: q('#parent span:only-child'),
        onlyFirst: q('#parent span:first-child'),
        rowsNth: q('#rows li:nth-child(2)'),
        rowsFirst: q('#rows li:first-child'),
        rowsLast: q('#rows li:last-of-type'),
        adjacent: q('.a + .b'),
        sibling: q('.a ~ .c'),
        child: q('#parent > span'),
        rowsChild: q('#rows > li'),
        empty: q('p:empty'),
        // DESCENDANT AND ANCESTOR MATCHING, named because they are the ones a wrapper element
        // would break and a comment cannot: a comment is not an element, so it joins no
        // combinator chain and is skipped by every one of these.
        descendant: q('#deep p'),
        deepDescendant: q('section div article p'),
        descendantClass: q('#deep .leaf'),
        ancestorHas: q('section:has(.leaf)'),
        ancestorHasDeep: q('div:has(> article p)'),
        universalDescendant: q('#deep * p'),
        starChild: q('#deep > *'),
        parentHasSpan: q('div:has(> span)'),
    }
})()`

/**
 * Every probe, answered by the reference, by the compiled page as served, and by it once mounted.
 *
 * A FRESH NAVIGATION PER DOCUMENT: `setContent` keeps the JavaScript context, so the compiled
 * arm's `__MOUNT__` would otherwise still be on the global when the next document loads. The body
 * holds the markup and nothing else, because the mount finds the page by the pair `render` wrote
 * as the body's first and last child.
 */
async function answersOf(
    page: import('@playwright/test').Page,
    probe: string,
): Promise<{ authored: Answers; served: Answers; hydrated: Answers }> {
    async function open(markup: string): Promise<void> {
        await page.goto('about:blank')
        await page.setContent(
            `<!doctype html><html><body>${markup}</body></html>`,
        )
    }
    await open(REFERENCE)
    const authored = (await page.evaluate(probe)) as Answers
    await open(compiled.markup)
    const served = (await page.evaluate(probe)) as Answers
    await page.addScriptTag({ content: compiled.script })
    await page.evaluate(() => {
        const lane = globalThis as unknown as {
            __MOUNT__: () => void
            __FLUSH__: () => void
        }
        lane.__MOUNT__()
        lane.__FLUSH__()
    })
    const hydrated = (await page.evaluate(probe)) as Answers
    return { authored, served, hydrated }
}

function differencesOf(authored: Answers, compiledAnswers: Answers): string[] {
    const differences: string[] = []
    for (const key of Object.keys(authored))
        if (authored[key] !== compiledAnswers[key])
            differences.push(
                `${key}: authored ${authored[key]} -> compiled ${compiledAnswers[key]}`,
            )
    return differences
}

// NOTHING ADDED WHERE A SLOT IS STATIC. The scheme that preceded this one put two comments round
// every slot and a `data-a` on every listener element, and reported four differences here —
// `[data-a]` matched in the document as served, `firstChild` a Comment where the author wrote a
// Text, and two nodes added to `childNodes` per slot, including in an element left empty. A text
// run is now written whole and found by child index from the region root, so the served document
// has nothing on the list.
//
// A RATCHET ONCE MOUNTED, of one entry: a slot whose value is EMPTY is no node in the served
// markup (32.23's hole), and `runHere` in `packages/abide/src/ui/adoptWalk.ts` puts an empty
// Text back as the walk passes, because every sibling after it is found from it. So `#blank` has 1 child node where the
// author wrote none, and that child is a Text — `:empty` still matches, since a zero-length Text
// does not count against it, and `blankIsEmpty` is on the probe to say so. Named here so that
// removing it fails this test and shrinks the list, and so that a second difference fails it too.
//
// THE REVERT: wrap both of `renderPosition`'s text-run returns in `emitComponent` in a comment
// pair, and the served document goes from 0 differences to 20 in both engines — every element
// holding a run, static or live, reports childNodes 1 -> 3 and firstChild 3 -> 8, and `#blank`
// 0 -> 2. Mounted, it is worse: `li.a` and `#filled` read their text twice.
test('a compiled document answers DOM queries over its static regions as the authored one does', async ({
    page,
}, testInfo) => {
    const { authored, served, hydrated } = await answersOf(page, DOM_PROBE)
    const asServed = differencesOf(authored, served)
    const afterMount = differencesOf(authored, hydrated)
    console.log(
        `\n=== ${testInfo.project.name} — compiled vs authored ===\n` +
            `  served:   ${asServed.length === 0 ? 'no difference' : asServed.join(', ')}\n` +
            `  hydrated: ${afterMount.length === 0 ? 'no difference' : afterMount.join(', ')}`,
    )
    expect(asServed).toEqual([])
    expect(afterMount).toEqual([
        '6 p#blank childNodes: authored 0 -> compiled 1',
        '6 p#blank firstChild: authored 0 -> compiled 3',
    ])
})

// WHAT IS SAFE, asserted so it is not re-litigated. CSS structural selectors are element-based and
// a comment is not an element, so a marker at a dynamic boundary cannot change what they match —
// including `:empty`, which both engines ignore comments for. The markers are asserted PRESENT
// first: on a document with none this test would compare a page to itself and prove nothing.
//
// THE REVERT: make `emitComponent`'s region anchors a wrapper element as well as the comment pair
// (`<!--[--><abide-region>` … `</abide-region><!--]-->`), and this reports three differences in
// both engines — `#parent > span` 1 -> 0, `#rows > li` 3 -> 0, `div:has(> span)` 1 -> 0. The
// marker revert above leaves it green, which is the claim: a comment cannot move a selector.
test('CSS structural matching is untouched by the markers at dynamic boundaries', async ({
    page,
}) => {
    await page.goto('about:blank')
    await page.setContent(
        `<!doctype html><html><body>${compiled.markup}</body></html>`,
    )
    const markers = (await page.evaluate(`(() => {
        const comments = (selector) => {
            let count = 0
            for (const node of document.querySelector(selector).childNodes)
                if (node.nodeType === 8) count += 1
            return count
        }
        return { parent: comments('#parent'), rows: comments('#rows') }
    })()`)) as { parent: number; rows: number }
    expect(
        markers.parent,
        'the {#if} left no marker to test against',
    ).toBeGreaterThan(0)
    expect(
        markers.rows,
        'the {#for} left no marker to test against',
    ).toBeGreaterThan(0)

    const { authored, served, hydrated } = await answersOf(page, CSS_PROBE)
    expect(differencesOf(authored, served)).toEqual([])
    expect(differencesOf(authored, hydrated)).toEqual([])
})
