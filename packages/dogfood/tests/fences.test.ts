import { expect, test } from 'bun:test'

import { docsPages, fencesOf } from './docsPages.ts'

// 40.14 — AN EXAMPLE IS CAPTIONED WITH ITS SIDE: one of BRAND's four side words, which is what colors
// the spine. An ADDRESS a reader cannot open is a claim: a page's Tests derive their captions from a
// file the build reads, and a hand-written fence captioned with a path derives nothing. A fence with
// no language — a shell command, a tree — has no side, and carries no caption. THE REVERT: caption a
// `ts` fence of `/reactive/watch` "watch.ts", or "#server/watch.ts", and it is named.
const SIDES = new Set(['browser', 'server', 'shared', 'abide'])

test('every example fence is captioned with the side its code runs on', async () => {
    const unsided: string[] = []
    for (const page of await docsPages())
        for (const fence of fencesOf(page))
            if (
                fence.language === ''
                    ? fence.caption !== ''
                    : !SIDES.has(fence.caption)
            )
                unsided.push(
                    `${page.route}: ${fence.language || '(none)'} "${fence.caption}"`,
                )
    expect(unsided).toEqual([])
})
