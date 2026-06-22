import { expect, test } from 'bun:test'
import { markFrameworkSourcesIgnored } from '../src/lib/shared/markFrameworkSourcesIgnored.ts'

/* Framework sources (the mount-stack wall) are ignore-listed by index; the author's
   `.abide` components and app `.ts` stay visible — that's what keeps their frames in
   the trace while the framework collapses. Both the standardized `ignoreList` and the
   legacy `x_google_ignoreList` alias are written for the widest debugger support. */
test('ignore-lists abide framework sources by index, leaving authored ones visible', () => {
    const map = markFrameworkSourcesIgnored({
        sources: [
            '../../../../packages/abide/src/lib/ui/runtime/runNode.ts', // framework (monorepo)
            '../../src/ui/pages/page.abide', // authored component
            '../../../node_modules/@abide/abide/src/lib/ui/dom/mountRange.ts', // framework (install)
            '../../src/server/rpc/getRates.ts', // authored app code
            null, // unknown source
        ],
    })
    expect(map.ignoreList).toEqual([0, 2])
    expect(map.x_google_ignoreList).toEqual([0, 2])
})

/* A user app whose own dir merely contains the substring `abide` must not match — the
   marker is the contiguous `abide/src/lib/` path, not a loose `abide` match. */
test('a user app dir containing "abide" is not mistaken for the framework', () => {
    const map = markFrameworkSourcesIgnored({
        sources: ['../../my-abide-app/src/lib/helpers.ts'],
    })
    expect(map.ignoreList).toEqual([])
})

test('a map with no sources yields an empty ignore list', () => {
    expect(markFrameworkSourcesIgnored({}).ignoreList).toEqual([])
})
