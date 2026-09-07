// Twenty checks guard the documentation's information architecture and not one of them guarded
// its PROSE, so the house voice lived in unwritten habits and nothing failed when it drifted.
// These two are the part of that voice worth defending, and they were chosen by MEASUREMENT
// rather than by borrowing a style guide whole.
//
// The corpus was 63 written pages and 36,630 words. Four candidate rules came out of AP:
//
//   positional reference   10 instances, 7 pages    -> gated, a defect
//   sentence over 45 words 26 instances, 21 pages   -> gated, a defect
//   em dashes              median 14/1k, worst 27   -> NOT gated, no outlier to catch
//   second person          median 5/1k, worst 51    -> NOT gated, wrong rule for documentation
//
// CHECKABLE IS NOT THE SAME AS WORTH CHECKING, which is the thing the measurement settled. An
// em-dash rule would have no violations to find at any threshold the corpus can meet — the whole
// corpus sits in one band — so it is a dial on taste rather than a detector. A second-person rule
// would fire hardest on the tutorial, where addressing the reader is the form. Both were dropped.

import { expect, test } from 'bun:test'
import { readPages } from '../scripts/buildDocs.ts'

// Prose only: a table cell, a fence, a directive and a heading are none of them sentences, and a
// code span is one token however long it is — `Reactive<Stored, Failures, Produced>` is not nine
// words of anybody's sentence.
function prose(body: string): string {
    return body
        .replaceAll(/```[\s\S]*?```/g, '')
        .replaceAll(/^\{%.*?%\}$/gm, '')
        .replaceAll(/^\|.*$/gm, '')
        .replaceAll(/^>.*$/gm, '')
        .replaceAll(/^#{1,6} .*$/gm, '')
        .replaceAll(/`[^`]*`/g, 'CODE')
}

// A sentence ends at punctuation followed by space, and a paragraph break ends one too — so a
// bullet list is n sentences rather than one run-on, which is what it reads as.
function sentences(body: string): string[] {
    const found: string[] = []
    for (const paragraph of prose(body).split(/\n\s*\n/)) {
        for (const sentence of paragraph.trim().split(/(?<=[.!?])\s+/)) {
            if (sentence.trim()) found.push(sentence)
        }
    }
    return found
}

// 45 rather than AP's ~25. The number is the corpus's, not a style guide's: at 45 there were 26
// sentences to split and at 40 there were 57, and the second number is a rewrite of the voice
// where the first is the removal of a run-on. A sentence this long is one no reading of the house
// style defends — the worst was 62 words and carried four clauses and a parenthetical.
const LONGEST = 45

test('no sentence runs past the length a reader can hold', async () => {
    const overlong: string[] = []
    for (const page of await readPages()) {
        if (page.stub) continue
        for (const sentence of sentences(page.body)) {
            const words = sentence.split(/\s+/).length
            if (words > LONGEST)
                overlong.push(`${page.slug}: ${words}w — ${sentence.slice(0, 60)}…`)
        }
    }
    expect(overlong).toEqual([])
})

// THE ONE THAT IS ACTUALLY A DEFECT. A positional reference assumes a reader who started at the
// top and is still there, and most readers arrive mid-page from a search or an error message —
// so "Every `Reactive` so far" and "the read the page already had" refer to nothing they have.
// It is also the rule the inverted-pyramid experiment identified before this file existed, and
// the only one of the four whose violations were all genuine on inspection.
//
// FORWARD REFERENCES COUNT TOO. "it is two sections down" is the same assumption pointed the
// other way: it is a claim about where the reader is, and the reader is somewhere else.
const POSITIONAL =
    /\b(so far|already had|as we saw|as above|mentioned above|earlier in this|the section above|previous section|everything below|two sections down)\b/i

test('no page points at another part of itself by position', async () => {
    const offenders: string[] = []
    for (const page of await readPages()) {
        if (page.stub) continue
        const found = POSITIONAL.exec(prose(page.body))
        if (found) offenders.push(`${page.slug}: "${found[0]}"`)
    }
    expect(offenders).toEqual([])
})

// A THIRD RULEBOOK HAD GROWN IN `content/`. RULEBOOK format rule 2 says a rule is stated exactly
// once, and `rulebook.test.ts` enforces that across the four documents in `docs/` — which is every
// place anybody thought to look. `styles/normative-spec.md` and `styles/caching-normative-spec.md`
// were meanwhile carrying 77 RFC-2119 requirements under their OWN clause numbers, and those
// numbers collide: their 6.3 is about a global body reading an ambient where RULEBOOK 6.3 is the
// unit of `tail`. One requirement had no clause behind it at all and lived only there, which is
// 11.60 now.
//
// Those two pages are the styles section demonstrating RFC 2119 AS A STYLE, so the keywords are
// the point and deleting them would delete what is being compared. The exemption is therefore
// listed rather than inferred — a third page reaching for MUST is what this catches, and adding it
// to this list is an edit a reviewer sees.
const NORMATIVE_BY_DESIGN = new Set(['styles/normative-spec', 'styles/caching-normative-spec'])

test('no guide states a requirement in the rulebook\'s keywords', async () => {
    const offenders: string[] = []
    for (const page of await readPages()) {
        if (NORMATIVE_BY_DESIGN.has(page.slug)) continue
        for (const sentence of sentences(page.body)) {
            if (/\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|MAY)\b/.test(sentence))
                offenders.push(`${page.slug}: ${sentence.trim().slice(0, 60)}…`)
        }
    }
    expect(offenders).toEqual([])
})
