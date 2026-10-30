// 40.34 — THE RULEBOOK PAGE IS THE FILE. Every clause and every group RULEBOOK.md has is an anchor
// on `/rulebook` named by its own number, and nothing else is: an editor links `/rulebook#41.10`,
// so a clause the page dropped, or one it still shows after a renumber, is a link that lands wrong.
//
// THE REVERT: drop `id="${id}"` from the clause markup in `rulebookOf.ts`, and every clause number
// is reported missing.

import { expect, test } from 'bun:test'

import { rulebookClauses } from '../scripts/rulebookClauses.ts'
import { servedDocs } from './docsPages.ts'

const rulebook = await Bun.file(
    new URL('../../../docs/RULEBOOK.md', import.meta.url),
).text()

test('the rulebook page anchors every clause and every group by its number, and nothing more', async () => {
    const expected: string[] = []
    for (const [, group] of rulebook.matchAll(/^# (\d+)\./gm))
        expected.push(group as string)
    for (const { id } of rulebookClauses(rulebook)) expected.push(id)

    const { base } = await servedDocs()
    const answer = await Bun.fetch(`${base}/rulebook`)
    expect(answer.status).toBe(200)
    const anchored: string[] = []
    for (const [, id] of (await answer.text()).matchAll(
        /\bid="(\d+(?:\.\d+)?)"/g,
    ))
        anchored.push(id as string)

    expect(anchored.length).toBeGreaterThan(900)
    expect(anchored.sort()).toEqual(expected.sort())
})
